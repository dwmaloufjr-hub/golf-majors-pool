import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function Rosters() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draftRevealed, setDraftRevealed] = useState(false);

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
        {users.map((u) => (
          <div key={u.id} className="roster-card-full">
            <div className="roster-card-header">
              <h3>{u.display_name}</h3>
              <span className="spent">${u.totalSpent} / $100</span>
            </div>
            <div className="roster-card-players">
              {u.roster.map((p) => (
                <div key={p.id} className="roster-player-row">
                  <span>{p.name}</span>
                  <span>${p.price}</span>
                </div>
              ))}
              {u.roster.length === 0 && (
                <p className="no-roster">No roster submitted</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
