import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST;

// Slash Golf tournament IDs for majors
const SLASH_GOLF_TOURNS = {
  'Masters': '014',
  'PGA Championship': '033',
  'U.S. Open': '026',
  'Open Championship': '100',
};

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

function parseNum(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && val.$numberInt) return parseInt(val.$numberInt, 10);
  if (typeof val === 'string') return parseInt(val, 10);
  return null;
}

function normalizeName(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Find active tournament
    const { data: activeTournament } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'in_progress')
      .single();

    if (!activeTournament) {
      return Response.json({ message: 'No active tournament' });
    }

    const slashTournId = SLASH_GOLF_TOURNS[activeTournament.name];
    if (!slashTournId) {
      return Response.json({ message: `No Slash Golf mapping for ${activeTournament.name}` });
    }

    const year = new Date(activeTournament.start_date).getFullYear().toString();

    // Fetch leaderboard and DB data in parallel
    const [leaderboard, { data: dbPlayers }, { data: rosters }] = await Promise.all([
      slashGolfFetch('/leaderboard', { orgId: '1', tournId: slashTournId, year }),
      supabase.from('players').select('id, dg_id, name'),
      supabase.from('rosters').select('player_id'),
    ]);

    const rows = leaderboard.leaderboardRows || [];
    if (rows.length === 0) return Response.json({ message: 'No leaderboard data' });
    if (!dbPlayers?.length) return Response.json({ message: 'No players in database' });

    // Get set of rostered player IDs (only fetch scorecards for these)
    const rosteredPlayerIds = new Set((rosters || []).map((r) => r.player_id));

    // Build name maps
    const nameToDbPlayer = {};
    const lastNameToDbPlayers = {};
    for (const p of dbPlayers) {
      nameToDbPlayer[normalizeName(p.name)] = p;
      const lastName = normalizeName(p.name.split(',')[0].trim());
      if (!lastNameToDbPlayers[lastName]) lastNameToDbPlayers[lastName] = [];
      lastNameToDbPlayers[lastName].push(p);
    }

    // Match leaderboard to DB, filter to rostered players only
    const matchedPlayers = [];
    for (const row of rows) {
      const nameKey = normalizeName(`${row.lastName}, ${row.firstName}`);
      let dbPlayer = nameToDbPlayer[nameKey];

      if (!dbPlayer) {
        const lastName = normalizeName(row.lastName);
        const firstName = normalizeName(row.firstName);
        const candidates = lastNameToDbPlayers[lastName] || [];
        for (const c of candidates) {
          const cFirst = normalizeName(c.name.split(',')[1]?.trim() || '');
          if (cFirst.startsWith(firstName) || firstName.startsWith(cFirst)) {
            dbPlayer = c;
            break;
          }
        }
      }

      if (dbPlayer && rosteredPlayerIds.has(dbPlayer.id)) {
        matchedPlayers.push({
          dbPlayer,
          slashPlayerId: row.playerId,
          position: row.position,
          thru: row.thru,
          status: row.status,
          total: row.total,
        });
      }
    }

    let scoresUpserted = 0;
    let playersUpdated = 0;

    // Fetch scorecards in parallel batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < matchedPlayers.length; i += BATCH_SIZE) {
      const batch = matchedPlayers.slice(i, i + BATCH_SIZE);

      const scorecardResults = await Promise.allSettled(
        batch.map((mp) =>
          slashGolfFetch('/scorecard', {
            orgId: '1',
            tournId: slashTournId,
            year,
            playerId: mp.slashPlayerId,
          }).then((data) => ({ mp, data }))
        )
      );

      for (const result of scorecardResults) {
        if (result.status !== 'fulfilled') continue;
        const { mp, data: scorecardData } = result.value;

        const rounds = Array.isArray(scorecardData) ? scorecardData : [];
        const scoreRows = [];

        for (const round of rounds) {
          const roundNum = parseNum(round.roundId);
          if (!roundNum || roundNum < 1 || roundNum > 4) continue;

          const holes = round.holes || {};
          for (const [holeKey, holeData] of Object.entries(holes)) {
            const holeNum = parseNum(holeData.holeId) || parseInt(holeKey, 10);
            const holeScore = parseNum(holeData.holeScore);
            const par = parseNum(holeData.par);
            if (holeScore === null || par === null) continue;

            const scoreVsPar = holeScore - par;
            scoreRows.push({
              tournament_id: activeTournament.id,
              player_id: mp.dbPlayer.id,
              round: roundNum,
              hole: holeNum,
              score_vs_par: scoreVsPar,
              points: holePoints(scoreVsPar),
            });
          }
        }

        // Batch upsert all scores for this player
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
          roundGroups[s.round].push({ scoreVsPar: s.score_vs_par });
        });
        for (const holes of Object.values(roundGroups)) {
          holes.sort((a, b) => a.hole - b.hole);
          totalPoints += streakBonuses(holes);
        }

        // Position + finish bonus
        const posStr = mp.position;
        let posNum = null;
        if (posStr && posStr !== '-') {
          posNum = parseInt(String(posStr).replace('T', ''), 10);
        }

        const isTournamentDone = leaderboard.status === 'Complete' || leaderboard.status === 'Official';
        if (isTournamentDone && posNum) {
          totalPoints += finishBonus(posNum);
        }

        const cutMade = mp.status === 'cut' ? false : (mp.status === 'active' || mp.status === 'complete') ? true : null;

        const { error: tpError } = await supabase.from('tournament_players').upsert(
          {
            tournament_id: activeTournament.id,
            player_id: mp.dbPlayer.id,
            in_field: true,
            cut_made: cutMade,
            finish_position: posNum,
            total_points: totalPoints,
          },
          { onConflict: 'tournament_id,player_id' }
        );
        if (!tpError) playersUpdated++;
      }
    }

    return Response.json({
      success: true,
      tournament: activeTournament.name,
      playersMatched: matchedPlayers.length,
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
