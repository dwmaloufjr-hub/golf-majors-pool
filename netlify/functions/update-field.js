import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ESPN_BASE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga';
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

function normalizeName(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/g, 'o').replace(/Ø/g, 'o')
    .replace(/æ/g, 'ae').replace(/Æ/g, 'ae')
    .toLowerCase();
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API error: ${res.status} for ${url}`);
  return res.json();
}

async function findEspnEventId(tournamentName, startDate) {
  const dateStr = startDate.replace(/-/g, '');
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  const endStr = endDate.toISOString().slice(0, 10).replace(/-/g, '');

  const data = await fetchJSON(`${ESPN_SCOREBOARD}?dates=${dateStr}-${endStr}`);
  const events = data.events || [];

  const keywords = {
    'Masters': ['masters'],
    'PGA Championship': ['pga championship'],
    'U.S. Open': ['u.s. open', 'us open'],
    'Open Championship': ['open championship', 'the open', 'british open'],
  };

  const searchTerms = keywords[tournamentName] || [tournamentName.toLowerCase()];
  for (const event of events) {
    const name = (event.name || '').toLowerCase();
    if (searchTerms.some((term) => name.includes(term))) {
      return event.id;
    }
  }
  return null;
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

    const espnEventId = await findEspnEventId(tournament.name, tournament.start_date);
    if (!espnEventId) {
      return Response.json({ message: `Could not find ESPN event for ${tournament.name}` });
    }

    const year = new Date(tournament.start_date).getFullYear().toString();
    const compBase = `${ESPN_BASE}/events/${espnEventId}/competitions/${espnEventId}`;

    // Get all ESPN competitors
    const compData = await fetchJSON(`${compBase}/competitors?limit=200`);
    const competitors = compData.items || [];

    if (competitors.length === 0) {
      return Response.json({ message: 'No field data available' });
    }

    // Get our player mapping
    const { data: players } = await supabase.from('players').select('id, name');
    const nameToPlayer = {};
    const lastNameToPlayers = {};
    for (const p of players || []) {
      const parts = p.name.split(',').map((s) => s.trim());
      const key = normalizeName(parts.length > 1 ? `${parts[1]} ${parts[0]}` : parts[0]);
      nameToPlayer[key] = p;
      const lastName = normalizeName(parts[0]);
      if (!lastNameToPlayers[lastName]) lastNameToPlayers[lastName] = [];
      lastNameToPlayers[lastName].push(p);
    }

    let updated = 0;
    const fieldPlayerIds = [];

    // Resolve athlete names in batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < competitors.length; i += BATCH_SIZE) {
      const batch = competitors.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (comp) => {
          const espnId = comp.id;
          const athlete = await fetchJSON(`${ESPN_BASE}/seasons/${year}/athletes/${espnId}`);
          const espnName = normalizeName(athlete.displayName || athlete.fullName || '');

          let dbPlayer = nameToPlayer[espnName];
          if (!dbPlayer) {
            const lastName = espnName.split(' ').pop();
            const candidates = lastNameToPlayers[normalizeName(lastName)] || [];
            for (const c of candidates) {
              const cParts = c.name.split(',').map((s) => normalizeName(s.trim()));
              const cFirst = cParts[1] || '';
              const eFirst = espnName.split(' ')[0];
              if (cFirst.startsWith(eFirst) || eFirst.startsWith(cFirst)) {
                dbPlayer = c;
                break;
              }
            }
          }

          return dbPlayer || null;
        })
      );

      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        const dbPlayer = result.value;
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
      espnEventId,
      playersInField: updated,
      totalFieldSize: competitors.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Field update error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
