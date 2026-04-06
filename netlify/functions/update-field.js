import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DATAGOLF_API_KEY = process.env.DATAGOLF_API_KEY;

/**
 * Updates the tournament_players table with the current field for the active tournament.
 * Run this before each major starts to populate who is playing.
 * Also useful for detecting withdrawals before Round 1.
 */
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

    // Fetch current field from Data Golf
    const url = `https://feeds.datagolf.com/field-updates?tour=pga&file_format=json&key=${DATAGOLF_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Data Golf API error: ${res.status}`);
    const data = await res.json();

    const field = data.field || data;
    if (!Array.isArray(field)) throw new Error('Unexpected field data structure');

    // Get our player mapping
    const { data: players } = await supabase.from('players').select('id, dg_id');
    const playerMap = {};
    (players || []).forEach((p) => { playerMap[p.dg_id] = p.id; });

    let updated = 0;
    const fieldPlayerIds = [];

    for (const entry of field) {
      const playerId = playerMap[entry.dg_id];
      if (!playerId) continue;

      fieldPlayerIds.push(playerId);

      const { error } = await supabase.from('tournament_players').upsert(
        {
          tournament_id: tournament.id,
          player_id: playerId,
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
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Field update error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
