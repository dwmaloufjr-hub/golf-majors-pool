import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DATAGOLF_API_KEY = process.env.DATAGOLF_API_KEY;

// Scoring rules per hole
function holePoints(scoreVsPar) {
  switch (scoreVsPar) {
    case -3: return 20;   // Double eagle / albatross
    case -2: return 8;    // Eagle
    case -1: return 3;    // Birdie
    case 0:  return 0.5;  // Par
    case 1:  return -0.5; // Bogey
    case 2:  return -1;   // Double bogey
    default: return scoreVsPar < -3 ? 20 : -1; // Better than double eagle or worse than double bogey
  }
}

// Finish position bonus
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

// Calculate streak bonuses for a round
function streakBonuses(holes) {
  let bonus = 0;
  let birdieStreak = 0;
  let hasBirdieStreakBonus = false;
  let hasBogey = false;

  for (const hole of holes) {
    if (hole.score_vs_par <= -1) {
      birdieStreak++;
      if (birdieStreak >= 3 && !hasBirdieStreakBonus) {
        bonus += 3; // 3+ birdie streak, max 1 per round
        hasBirdieStreakBonus = true;
      }
    } else {
      birdieStreak = 0;
    }

    if (hole.score_vs_par >= 1) hasBogey = true;

    // Hole in one (par 3, score_vs_par = -2 means eagle on par 3 = hole in one)
    // We'll check for ace via score_vs_par on par 3s, but we don't have par info
    // So we'll use a simpler heuristic: any hole with score_vs_par <= -3 on a likely par 3
    // For now, we'll flag aces if the score is 1 (handled separately if we get raw scores)
  }

  // Bogey-free round (all 18 holes played, no bogeys)
  if (!hasBogey && holes.length === 18) bonus += 3;

  return bonus;
}

export default async function handler(req) {
  // Only allow POST or scheduled invocation
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

    // Fetch live stats from Data Golf
    const statsUrl = `https://feeds.datagolf.com/preds/live-tournament-stats?file_format=json&key=${DATAGOLF_API_KEY}`;
    const statsRes = await fetch(statsUrl);
    if (!statsRes.ok) throw new Error(`Data Golf stats API error: ${statsRes.status}`);
    const statsData = await statsRes.json();

    // Fetch live scoring
    const liveUrl = `https://feeds.datagolf.com/preds/in-play?tour=pga&file_format=json&key=${DATAGOLF_API_KEY}`;
    const liveRes = await fetch(liveUrl);
    if (!liveRes.ok) throw new Error(`Data Golf live API error: ${liveRes.status}`);
    const liveData = await liveRes.json();

    // Get our player mapping (dg_id -> uuid)
    const { data: players } = await supabase.from('players').select('id, dg_id');
    const playerMap = {};
    (players || []).forEach((p) => { playerMap[p.dg_id] = p.id; });

    // Process live scoring data
    const scorecards = statsData.live_stats || statsData.data || [];
    let scoresUpserted = 0;
    let playersUpdated = 0;

    for (const card of scorecards) {
      const playerId = playerMap[card.dg_id];
      if (!playerId) continue;

      // Process hole-by-hole scores if available
      if (card.round_scores || card.hole_scores) {
        const roundScores = card.round_scores || card.hole_scores;

        for (const [roundKey, holes] of Object.entries(roundScores)) {
          const roundNum = parseInt(roundKey.replace('R', '').replace('round', ''), 10);
          if (isNaN(roundNum) || roundNum < 1 || roundNum > 4) continue;

          if (Array.isArray(holes)) {
            for (let i = 0; i < holes.length; i++) {
              const scoreVsPar = holes[i];
              if (scoreVsPar === null || scoreVsPar === undefined) continue;

              const points = holePoints(scoreVsPar);
              const { error } = await supabase.from('scores').upsert(
                {
                  tournament_id: activeTournament.id,
                  player_id: playerId,
                  round: roundNum,
                  hole: i + 1,
                  score_vs_par: scoreVsPar,
                  points,
                },
                { onConflict: 'tournament_id,player_id,round,hole' }
              );
              if (!error) scoresUpserted++;
            }
          }
        }
      }

      // Update tournament_players with current status
      const cutMade = card.made_cut !== undefined ? card.made_cut : null;
      const finishPos = card.fin_pos || card.position || null;

      // Calculate total points from all scores for this player
      const { data: playerScores } = await supabase
        .from('scores')
        .select('*')
        .eq('tournament_id', activeTournament.id)
        .eq('player_id', playerId)
        .order('round')
        .order('hole');

      let totalPoints = 0;
      if (playerScores) {
        totalPoints = playerScores.reduce((sum, s) => sum + Number(s.points), 0);

        // Add streak bonuses per round
        const roundGroups = {};
        playerScores.forEach((s) => {
          if (!roundGroups[s.round]) roundGroups[s.round] = [];
          roundGroups[s.round].push(s);
        });
        for (const holes of Object.values(roundGroups)) {
          holes.sort((a, b) => a.hole - b.hole);
          totalPoints += streakBonuses(holes);
        }
      }

      // Add finish bonus
      if (finishPos) {
        const pos = typeof finishPos === 'string' ? parseInt(finishPos.replace('T', ''), 10) : finishPos;
        totalPoints += finishBonus(pos);
      }

      const { error: tpError } = await supabase.from('tournament_players').upsert(
        {
          tournament_id: activeTournament.id,
          player_id: playerId,
          in_field: true,
          cut_made: cutMade,
          finish_position: typeof finishPos === 'string' ? parseInt(finishPos.replace('T', ''), 10) : finishPos,
          total_points: totalPoints,
        },
        { onConflict: 'tournament_id,player_id' }
      );
      if (!tpError) playersUpdated++;
    }

    return Response.json({
      success: true,
      tournament: activeTournament.name,
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
  // Run every 5 minutes during tournaments
  schedule: '*/5 * * * *',
};
