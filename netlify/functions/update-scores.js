import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ESPN_BASE = 'https://sports.core.api.espn.com/v2/sports/golf/leagues/pga';
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

function holePoints(scoreVsPar) {
  switch (scoreVsPar) {
    case -3: return 20;
    case -2: return 8;
    case -1: return 3;
    case 0:  return 0.5;
    case 1:  return -0.5;
    case 2:  return -1;
    default: return scoreVsPar < -3 ? 20 : -1;
  }
}

function finishBonus(position) {
  if (!position || position <= 0) return 0;
  const bonuses = { 1: 30, 2: 20, 3: 18, 4: 16, 5: 14, 6: 12, 7: 10, 8: 9, 9: 8, 10: 7 };
  if (bonuses[position]) return bonuses[position];
  if (position <= 15) return 6;
  if (position <= 20) return 5;
  if (position <= 25) return 4;
  if (position <= 30) return 3;
  if (position <= 40) return 2;
  if (position <= 50) return 1;
  return 0;
}

function streakBonuses(holes) {
  let bonus = 0;
  let birdieStreak = 0;
  let hasBirdieStreakBonus = false;
  let hasBogey = false;

  for (const hole of holes) {
    if (hole.scoreVsPar <= -1) {
      birdieStreak++;
      if (birdieStreak >= 3 && !hasBirdieStreakBonus) {
        bonus += 3;
        hasBirdieStreakBonus = true;
      }
    } else {
      birdieStreak = 0;
    }
    if (hole.scoreVsPar >= 1) hasBogey = true;
  }

  if (!hasBogey && holes.length === 18) bonus += 3;
  return bonus;
}

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

// Find the ESPN event ID for a tournament by searching the scoreboard
async function findEspnEventId(tournamentName, startDate) {
  const dateStr = startDate.replace(/-/g, '');
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  const endStr = endDate.toISOString().slice(0, 10).replace(/-/g, '');

  const data = await fetchJSON(`${ESPN_SCOREBOARD}?dates=${dateStr}-${endStr}`);
  const events = data.events || [];

  // Match by name keywords
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
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Auto-activate: if an upcoming tournament's start_date has arrived, flip it to in_progress
    const today = new Date().toISOString().slice(0, 10);
    await supabase
      .from('tournaments')
      .update({ status: 'in_progress' })
      .eq('status', 'upcoming')
      .lte('start_date', today);

    // Find active tournament
    const { data: activeTournament } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'in_progress')
      .single();

    if (!activeTournament) {
      return Response.json({ message: 'No active tournament' });
    }

    // Find ESPN event ID
    const espnEventId = await findEspnEventId(activeTournament.name, activeTournament.start_date);
    if (!espnEventId) {
      return Response.json({ message: `Could not find ESPN event for ${activeTournament.name}` });
    }

    const year = new Date(activeTournament.start_date).getFullYear().toString();
    const compBase = `${ESPN_BASE}/events/${espnEventId}/competitions/${espnEventId}`;

    // Fetch DB data in parallel
    const [{ data: dbPlayers }, { data: rosters }] = await Promise.all([
      supabase.from('players').select('id, name'),
      supabase.from('rosters').select('player_id'),
    ]);

    if (!dbPlayers?.length) return Response.json({ message: 'No players in database' });

    const rosteredPlayerIds = new Set((rosters || []).map((r) => r.player_id));

    // Build name maps: "first last" (normalized) -> dbPlayer
    const nameToDbPlayer = {};
    const lastNameToDbPlayers = {};
    for (const p of dbPlayers) {
      const parts = p.name.split(',').map((s) => s.trim());
      const key = normalizeName(parts.length > 1 ? `${parts[1]} ${parts[0]}` : parts[0]);
      nameToDbPlayer[key] = p;
      const lastName = normalizeName(parts[0]);
      if (!lastNameToDbPlayers[lastName]) lastNameToDbPlayers[lastName] = [];
      lastNameToDbPlayers[lastName].push(p);
    }

    // Get all ESPN competitors
    const compData = await fetchJSON(`${compBase}/competitors?limit=200`);
    const competitors = compData.items || [];

    let scoresUpserted = 0;
    let playersUpdated = 0;
    let playersMatched = 0;

    // Process in batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < competitors.length; i += BATCH_SIZE) {
      const batch = competitors.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (comp) => {
          const espnId = comp.id;

          // Get athlete name
          const athlete = await fetchJSON(`${ESPN_BASE}/seasons/${year}/athletes/${espnId}`);
          const espnName = normalizeName(athlete.displayName || athlete.fullName || '');

          // Match to DB player
          let dbPlayer = nameToDbPlayer[espnName];
          if (!dbPlayer) {
            const lastName = espnName.split(' ').pop();
            const candidates = lastNameToDbPlayers[normalizeName(lastName)] || [];
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

          if (!dbPlayer || !rosteredPlayerIds.has(dbPlayer.id)) return null;
          playersMatched++;

          // Get status (position, cut) and linescores in parallel
          const [status, lsData] = await Promise.all([
            fetchJSON(`${compBase}/competitors/${espnId}/status`),
            fetchJSON(`${compBase}/competitors/${espnId}/linescores`),
          ]);

          const posNum = status.position?.id ? parseInt(status.position.id) : null;
          const statusName = status.type?.name;
          const isTournamentDone = statusName === 'STATUS_FINISH' || statusName === 'STATUS_COMPLETE';
          const cutMade = statusName === 'STATUS_CUT' ? false : isTournamentDone ? true : null;

          // Parse linescores into score rows
          const rounds = lsData.items || [];
          const scoreRows = [];

          for (const round of rounds) {
            const roundNum = round.period;
            if (!roundNum || roundNum < 1 || roundNum > 4) continue;
            const holes = round.linescores || [];
            for (const hole of holes) {
              const holeNum = hole.period;
              const score = hole.value;
              const par = hole.par;
              if (score == null || par == null) continue;
              const scoreVsPar = score - par;
              scoreRows.push({
                tournament_id: activeTournament.id,
                player_id: dbPlayer.id,
                round: roundNum,
                hole: holeNum,
                score_vs_par: scoreVsPar,
                points: holePoints(scoreVsPar),
              });
            }
          }

          // Upsert scores
          if (scoreRows.length > 0) {
            const { error } = await supabase
              .from('scores')
              .upsert(scoreRows, { onConflict: 'tournament_id,player_id,round,hole' });
            if (!error) scoresUpserted += scoreRows.length;
          }

          // Calculate total points
          let totalPoints = scoreRows.reduce((sum, s) => sum + s.points, 0);

          // Streak bonuses per round
          const roundGroups = {};
          scoreRows.forEach((s) => {
            if (!roundGroups[s.round]) roundGroups[s.round] = [];
            roundGroups[s.round].push({ scoreVsPar: s.score_vs_par, hole: s.hole });
          });
          for (const holes of Object.values(roundGroups)) {
            holes.sort((a, b) => a.hole - b.hole);
            totalPoints += streakBonuses(holes);
          }

          // Finish bonus (apply for all finished players — position is final)
          if (isTournamentDone && posNum) {
            totalPoints += finishBonus(posNum);
          }

          // Upsert tournament_player
          const { error: tpError } = await supabase.from('tournament_players').upsert(
            {
              tournament_id: activeTournament.id,
              player_id: dbPlayer.id,
              in_field: true,
              cut_made: cutMade,
              finish_position: posNum,
              total_points: totalPoints,
            },
            { onConflict: 'tournament_id,player_id' }
          );
          if (!tpError) playersUpdated++;

          return dbPlayer;
        })
      );
    }

    return Response.json({
      success: true,
      tournament: activeTournament.name,
      espnEventId,
      playersMatched,
      scoresUpserted,
      playersUpdated,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Scoring error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export const config = {
  schedule: '*/5 * * * *',
};
