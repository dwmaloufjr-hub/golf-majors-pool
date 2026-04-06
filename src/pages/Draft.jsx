import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const BUDGET = 100;

export default function Draft() {
  const { user } = useAuth();
  const [players, setPlayers] = useState([]);
  const [roster, setRoster] = useState([]);
  const [existingRoster, setExistingRoster] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('price-desc');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [draftDeadline, setDraftDeadline] = useState(null);
  const [isPastDeadline, setIsPastDeadline] = useState(false);

  const spent = roster.reduce((sum, p) => sum + p.price, 0);
  const remaining = BUDGET - spent;

  useEffect(() => {
    fetchPlayers();
    fetchDraftDeadline();
    if (user) fetchExistingRoster();
  }, [user]);

  async function fetchPlayers() {
    const { data } = await supabase
      .from('players')
      .select('*')
      .order('price', { ascending: false });
    setPlayers(data || []);
  }

  async function fetchDraftDeadline() {
    const { data } = await supabase
      .from('tournaments')
      .select('draft_deadline')
      .eq('name', 'Masters')
      .single();
    if (data?.draft_deadline) {
      setDraftDeadline(new Date(data.draft_deadline));
      setIsPastDeadline(new Date() > new Date(data.draft_deadline));
    }
  }

  async function fetchExistingRoster() {
    const { data } = await supabase
      .from('rosters')
      .select('*, player:players(*)')
      .eq('user_id', user.id)
      .is('tournament_id', null);
    if (data?.length) {
      setExistingRoster(data);
      setRoster(data.map((r) => r.player));
    }
  }

  function addPlayer(player) {
    if (roster.find((p) => p.id === player.id)) return;
    if (player.price > remaining) return;
    setRoster([...roster, player]);
  }

  function removePlayer(playerId) {
    setRoster(roster.filter((p) => p.id !== playerId));
  }

  async function submitRoster() {
    if (isPastDeadline) {
      setMessage('Draft deadline has passed!');
      return;
    }
    setSubmitting(true);
    setMessage('');

    try {
      // Delete existing roster entries if re-drafting
      if (existingRoster) {
        await supabase
          .from('rosters')
          .delete()
          .eq('user_id', user.id)
          .is('tournament_id', null);
      }

      // Insert new roster
      const entries = roster.map((p) => ({
        user_id: user.id,
        player_id: p.id,
        is_sub: false,
        tournament_id: null,
      }));

      const { error } = await supabase.from('rosters').insert(entries);
      if (error) throw error;

      setExistingRoster(entries);
      setMessage('Roster submitted successfully!');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const filteredPlayers = useMemo(() => {
    let list = players.filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase())
    );

    switch (sortBy) {
      case 'price-desc':
        list.sort((a, b) => b.price - a.price);
        break;
      case 'price-asc':
        list.sort((a, b) => a.price - b.price);
        break;
      case 'name':
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return list;
  }, [players, search, sortBy]);

  return (
    <div className="draft-page">
      <div className="draft-header">
        <h1>Draft Your Roster</h1>
        {draftDeadline && (
          <p className="deadline">
            Deadline: {draftDeadline.toLocaleString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZoneName: 'short',
            })}
          </p>
        )}
      </div>

      <div className="draft-layout">
        {/* Player Market */}
        <div className="player-market">
          <h2>Player Market</h2>
          <div className="market-controls">
            <input
              type="text"
              placeholder="Search players..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="search-input"
            />
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="price-desc">Price: High → Low</option>
              <option value="price-asc">Price: Low → High</option>
              <option value="name">Name: A → Z</option>
            </select>
          </div>

          <div className="player-list">
            {filteredPlayers.map((player) => {
              const inRoster = roster.find((p) => p.id === player.id);
              const tooExpensive = player.price > remaining && !inRoster;
              return (
                <div
                  key={player.id}
                  className={`player-card ${inRoster ? 'selected' : ''} ${tooExpensive ? 'disabled' : ''}`}
                  onClick={() => !isPastDeadline && !inRoster && !tooExpensive && addPlayer(player)}
                >
                  <span className="player-name">{player.name}</span>
                  <span className="player-price">${player.price}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Roster */}
        <div className="roster-panel">
          <h2>Your Roster</h2>
          <div className="budget-bar">
            <div className="budget-info">
              <span>Budget: <strong>${remaining}</strong> remaining</span>
              <span>${spent} / ${BUDGET} spent</span>
            </div>
            <div className="budget-track">
              <div
                className="budget-fill"
                style={{ width: `${(spent / BUDGET) * 100}%` }}
              />
            </div>
          </div>

          <div className="roster-list">
            {roster.length === 0 ? (
              <p className="empty-roster">Click players to add them to your roster</p>
            ) : (
              roster.map((player) => (
                <div key={player.id} className="roster-card">
                  <span className="player-name">{player.name}</span>
                  <span className="player-price">${player.price}</span>
                  {!isPastDeadline && (
                    <button
                      className="remove-btn"
                      onClick={() => removePlayer(player.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="roster-summary">
            <p>{roster.length} players selected</p>
            {message && (
              <p className={message.startsWith('Error') ? 'error-msg' : 'success-msg'}>
                {message}
              </p>
            )}
            {!isPastDeadline && (
              <button
                className="submit-btn"
                onClick={submitRoster}
                disabled={roster.length === 0 || submitting}
              >
                {submitting ? 'Submitting...' : existingRoster ? 'Update Roster' : 'Submit Roster'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
