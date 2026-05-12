import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST;

const SLASH_GOLF_TOURNS = {
  'Masters': '014',
  'PGA Championship': '033',
  'U.S. Open': '026',
  'Open Championship': '100',
};

function normalizeName(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/g, 'o').replace(/Ø/g, 'o')
    .replace(/æ/g, 'ae').replace(/Æ/g, 'ae')
    .toLowerCase();
}

async function slashGolfFetch(endpoint, params) {
  const url = new URL(`https://${RAPIDAPI_HOST}${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { 'X-RapidAPI-Key': RAPIDAPI_KEY, 'X-RapidAPI-Host': RAPIDAPI_HOST },
  });
  if (!res.ok) throw new Error(`Slash Golf API error: ${res.status}`);
  return res.json();
}

export default async function handler(req) {
  try {
    // Find the next upcoming or in_progress tournament
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('*')
      .in('status', ['upcoming', 'in_progress'])
      .order('start_date')
      .limit(1)
      .single();

    if (!tournament) {
      return Response.json({ message: 'No upcoming tournament' });
    }

    const slashTournId = SLASH_GOLF_TOURNS[tournament.name];
    if (!slashTournId) {
      return Response.json({ message: `No Slash Golf mapping for ${tournament.name}` });
    }

    const year = new Date(tournament.start_date).getFullYear().toString();

    // Fetch leaderboard/field from Slash Golf
    const leaderboard = await slashGolfFetch('/leaderboard', {
      orgId: '1',
      tournId: slashTournId,
      year,
    });

    const rows = leaderboard.leaderboardRows || [];
    if (rows.length === 0) {
      return Response.json({ message: 'No field data available' });
    }

    // Get our player mapping
    const { data: players } = await supabase.from('players').select('id, name');
    const nameToPlayer = {};
    const lastNameToPlayers = {};
    for (const p of players || []) {
      nameToPlayer[normalizeName(p.name)] = p;
      const lastName = normalizeName(p.name.split(',')[0].trim());
      if (!lastNameToPlayers[lastName]) lastNameToPlayers[lastName] = [];
      lastNameToPlayers[lastName].push(p);
    }

    let updated = 0;
    const fieldPlayerIds = [];

    for (const row of rows) {
      const nameKey = normalizeName(`${row.lastName}, ${row.firstName}`);
      let dbPlayer = nameToPlayer[nameKey];

      if (!dbPlayer) {
        const lastName = normalizeName(row.lastName);
        const firstName = normalizeName(row.firstName);
        const candidates = lastNameToPlayers[lastName] || [];
        for (const c of candidates) {
          const cFirst = normalizeName(c.name.split(',')[1]?.trim() || '');
          if (cFirst.startsWith(firstName) || firstName.startsWith(cFirst)) {
            dbPlayer = c;
            break;
          }
        }
      }

      if (!dbPlayer) continue;

      fieldPlayerIds.push(dbPlayer.id);

      const { error } = await supabase.from('tournament_players').upsert(
        {
          tournament_id: tournament.id,
          player_id: dbPlayer.id,
          in_field: true,
        },
        { onConflict: 'tournament_id,player_id' }
      );
      if (!error) updated++;
    }

    // Mark players NOT in the field as out
    if (fieldPlayerIds.length > 0) {
      await supabase
        .from('tournament_players')
        .update({ in_field: false })
        .eq('tournament_id', tournament.id)
        .not('player_id', 'in', `(${fieldPlayerIds.join(',')})`);
    }

    return Response.json({
      success: true,
      tournament: tournament.name,
      playersInField: updated,
      totalFieldSize: rows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Field update error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
