import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function Rosters() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draftRevealed, setDraftRevealed] = useState(false);
  const [missingPlayerIds, setMissingPlayerIds] = useState(new Set());
  const [nextTournament, setNextTournament] = useState(null);

  useEffect(() => {
    checkDraftDeadline();
  }, []);

  async function checkDraftDeadline() {
    const { data: masters } = await supabase
      .from('tournaments')
      .select('draft_deadline')
      .eq('name', 'Masters')
      .single();

    if (masters?.draft_deadline && new Date() > new Date(masters.draft_deadline)) {
      setDraftRevealed(true);
      fetchRosters();
    } else {
      setDraftRevealed(false);
      setLoading(false);
    }
  }

  async function fetchRosters() {
    const { data: allUsers } = await supabase
      .from('users')
      .select('id, display_name');

    const { data: rosters } = await supabase
      .from('rosters')
      .select('*, player:players(*)')
      .is('tournament_id', null)
      .eq('is_sub', false);

    // Find the next upcoming tournament to check field status
    const { data: upcoming } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'upcoming')
      .order('start_date')
      .limit(1);

    const next = upcoming?.[0] || null;
    setNextTournament(next);

    // Get players NOT in the next tournament's field
    if (next) {
      const { data: tpData } = await supabase
        .from('tournament_players')
        .select('player_id, in_field')
        .eq('tournament_id', next.id)
        .eq('in_field', false);

      setMissingPlayerIds(new Set((tpData || []).map((tp) => tp.player_id)));
    }

    const userRosters = (allUsers || []).map((u) => ({
      ...u,
      roster: (rosters || [])
        .filter((r) => r.user_id === u.id)
        .map((r) => r.player)
        .sort((a, b) => b.price - a.price),
      totalSpent: (rosters || [])
        .filter((r) => r.user_id === u.id)
        .reduce((sum, r) => sum + (r.player?.price || 0), 0),
    }));

    userRosters.sort((a, b) => b.roster.length - a.roster.length);
    setUsers(userRosters);
    setLoading(false);
  }

  if (loading) return <div className="loading">Loading...</div>;

  if (!draftRevealed) {
    return (
      <div className="rosters-page">
        <h1>Rosters</h1>
        <div className="draft-locked">
          <h2>Draft Still Open</h2>
          <p>Rosters will be revealed after the draft deadline.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rosters-page">
      <h1>All Rosters</h1>
      <div className="rosters-grid">
        {users.map((u) => {
          const missingPlayers = u.roster.filter((p) => missingPlayerIds.has(p.id));

          return (
            <div key={u.id} className="roster-card-full">
              <div className="roster-card-header">
                <h3>{u.display_name}</h3>
                <span className="spent">${u.totalSpent} / $100</span>
              </div>
              {missingPlayers.length > 0 && nextTournament && (
                <div className="roster-missing-callout">
                  <span className="missing-icon">⚠️</span>
                  <span>
                    Not in {nextTournament.name} field:{' '}
                    <strong>{missingPlayers.map((p) => p.name.split(', ')[0]).join(', ')}</strong>
                    {' — '}sub needed
                  </span>
                </div>
              )}
              <div className="roster-card-players">
                {u.roster.map((p) => (
                  <div
                    key={p.id}
                    className={`roster-player-row ${missingPlayerIds.has(p.id) ? 'player-missing' : ''}`}
                  >
                    <span>{p.name}</span>
                    <span>${p.price}</span>
                  </div>
                ))}
                {u.roster.length === 0 && (
                  <p className="no-roster">No roster submitted</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
