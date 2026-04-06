import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function Substitutions() {
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [myRoster, setMyRoster] = useState([]);
  const [availableSubs, setAvailableSubs] = useState([]);
  const [tournamentField, setTournamentField] = useState([]);
  const [pendingSubs, setPendingSubs] = useState({}); // { originalPlayerId: subPlayerId }
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchTournaments();
  }, []);

  useEffect(() => {
    if (selectedTournament && user) {
      fetchMyRoster();
      fetchTournamentField();
    }
  }, [selectedTournament, user]);

  async function fetchTournaments() {
    const { data } = await supabase
      .from('tournaments')
      .select('*')
      .neq('name', 'Masters') // No subs for Masters (it's the draft tournament)
      .order('start_date');
    setTournaments(data || []);
    if (data?.length) setSelectedTournament(data[0]);
  }

  async function fetchMyRoster() {
    // Get original draft picks
    const { data: originals } = await supabase
      .from('rosters')
      .select('*, player:players(*)')
      .eq('user_id', user.id)
      .is('tournament_id', null)
      .eq('is_sub', false);

    // Get existing subs for this tournament
    const { data: existingSubs } = await supabase
      .from('rosters')
      .select('*, player:players(*)')
      .eq('user_id', user.id)
      .eq('tournament_id', selectedTournament.id)
      .eq('is_sub', true);

    // Merge: show original players, mark which ones have subs
    const roster = (originals || []).map((r) => {
      const sub = (existingSubs || []).find(
        (s) => s.player_id !== r.player_id // sub replaces an original
      );
      return {
        ...r,
        existingSub: sub || null,
      };
    });

    setMyRoster(roster);
  }

  async function fetchTournamentField() {
    // Get players in the tournament field
    const { data } = await supabase
      .from('tournament_players')
      .select('player_id')
      .eq('tournament_id', selectedTournament.id)
      .eq('in_field', true);

    const fieldPlayerIds = (data || []).map((tp) => tp.player_id);
    setTournamentField(fieldPlayerIds);

    // Get all players for sub selection
    const { data: allPlayers } = await supabase
      .from('players')
      .select('*')
      .order('price', { ascending: false });
    setAvailableSubs(allPlayers || []);
  }

  function isPlayerMissing(playerId) {
    // Player is missing if tournament_players table exists and they're not in the field
    // If tournament_players is empty (field not loaded yet), we can't determine
    if (tournamentField.length === 0) return false;
    return !tournamentField.includes(playerId);
  }

  function isSubDeadlinePassed() {
    if (!selectedTournament?.sub_deadline) return true;
    return new Date() > new Date(selectedTournament.sub_deadline);
  }

  function canSubPlayer(originalPlayer, subPlayer) {
    // Sub must cost <= original player's price
    return subPlayer.price <= originalPlayer.price;
  }

  function selectSub(originalPlayerId, subPlayerId) {
    setPendingSubs((prev) => ({ ...prev, [originalPlayerId]: subPlayerId }));
  }

  function cancelSub(originalPlayerId) {
    setPendingSubs((prev) => {
      const next = { ...prev };
      delete next[originalPlayerId];
      return next;
    });
  }

  async function submitSubs() {
    setSubmitting(true);
    setMessage('');

    try {
      const entries = Object.entries(pendingSubs);
      if (!entries.length) return;

      // Delete any existing subs for this tournament/user
      await supabase
        .from('rosters')
        .delete()
        .eq('user_id', user.id)
        .eq('tournament_id', selectedTournament.id)
        .eq('is_sub', true);

      // Insert new subs
      const subRecords = entries.map(([, subPlayerId]) => ({
        user_id: user.id,
        player_id: subPlayerId,
        is_sub: true,
        tournament_id: selectedTournament.id,
      }));

      const { error } = await supabase.from('rosters').insert(subRecords);
      if (error) throw error;

      setMessage('Substitutions saved!');
      setPendingSubs({});
      fetchMyRoster();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const deadlinePassed = isSubDeadlinePassed();

  return (
    <div className="subs-page">
      <h1>Substitutions</h1>

      {/* Tournament selector */}
      <div className="tournament-filter">
        {tournaments.map((t) => (
          <button
            key={t.id}
            className={selectedTournament?.id === t.id ? 'active' : ''}
            onClick={() => {
              setSelectedTournament(t);
              setPendingSubs({});
              setMessage('');
            }}
          >
            {t.name}
          </button>
        ))}
      </div>

      {selectedTournament && (
        <>
          <p className="deadline">
            Sub deadline:{' '}
            {selectedTournament.sub_deadline
              ? new Date(selectedTournament.sub_deadline).toLocaleString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZoneName: 'short',
                })
              : 'TBD'}
            {deadlinePassed && <span className="deadline-passed"> (Passed)</span>}
          </p>

          {myRoster.length === 0 ? (
            <div className="draft-locked">
              <h2>No Roster Found</h2>
              <p>Submit your draft roster first before making substitutions.</p>
            </div>
          ) : (
            <div className="subs-layout">
              {/* My Roster - show which players need subs */}
              <div className="subs-roster">
                <h2>Your Roster</h2>
                <p className="subs-hint">
                  Players not in the {selectedTournament.name} field can be substituted.
                </p>
                {myRoster.map((entry) => {
                  const missing = isPlayerMissing(entry.player_id);
                  const pendingSub = pendingSubs[entry.player_id];
                  const subPlayer = pendingSub
                    ? availableSubs.find((p) => p.id === pendingSub)
                    : null;

                  return (
                    <div
                      key={entry.id}
                      className={`sub-roster-row ${missing ? 'missing' : 'in-field'}`}
                    >
                      <div className="sub-player-info">
                        <span className={`status-dot ${missing ? 'out' : 'in'}`} />
                        <span className="player-name">{entry.player?.name}</span>
                        <span className="player-price">${entry.player?.price}</span>
                      </div>

                      {missing && !deadlinePassed && (
                        <div className="sub-action">
                          {subPlayer ? (
                            <div className="sub-selected">
                              <span>→ {subPlayer.name} (${subPlayer.price})</span>
                              <button
                                className="remove-btn"
                                onClick={() => cancelSub(entry.player_id)}
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            <span className="needs-sub">Needs sub (≤${entry.player?.price})</span>
                          )}
                        </div>
                      )}

                      {entry.existingSub && (
                        <div className="existing-sub">
                          Sub: {entry.existingSub.player?.name}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Available Subs */}
              {!deadlinePassed && Object.keys(pendingSubs).length < myRoster.filter((r) => isPlayerMissing(r.player_id)).length && (
                <div className="subs-market">
                  <h2>Available Substitutes</h2>
                  <input
                    type="text"
                    placeholder="Search players..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="search-input"
                  />
                  <div className="player-list">
                    {availableSubs
                      .filter((p) =>
                        p.name.toLowerCase().includes(search.toLowerCase())
                      )
                      .filter((p) => {
                        // Only show players who are in the tournament field
                        if (tournamentField.length > 0 && !tournamentField.includes(p.id)) return false;
                        // Don't show players already on roster
                        if (myRoster.find((r) => r.player_id === p.id)) return false;
                        // Don't show already-selected subs
                        if (Object.values(pendingSubs).includes(p.id)) return false;
                        return true;
                      })
                      .map((player) => {
                        // Find which missing roster slot this could fill
                        const eligibleSlots = myRoster.filter(
                          (r) =>
                            isPlayerMissing(r.player_id) &&
                            !pendingSubs[r.player_id] &&
                            canSubPlayer(r.player, player)
                        );

                        return (
                          <div key={player.id} className="player-card">
                            <span className="player-name">{player.name}</span>
                            <span className="player-price">${player.price}</span>
                            {eligibleSlots.length > 0 && (
                              <div className="sub-for-buttons">
                                {eligibleSlots.map((slot) => (
                                  <button
                                    key={slot.id}
                                    className="sub-for-btn"
                                    onClick={() => selectSub(slot.player_id, player.id)}
                                  >
                                    Sub for {slot.player?.name?.split(', ')[0]}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Submit */}
          {Object.keys(pendingSubs).length > 0 && !deadlinePassed && (
            <div className="subs-submit">
              {message && (
                <p className={message.startsWith('Error') ? 'error-msg' : 'success-msg'}>
                  {message}
                </p>
              )}
              <button
                className="submit-btn"
                onClick={submitSubs}
                disabled={submitting}
              >
                {submitting ? 'Saving...' : `Submit ${Object.keys(pendingSubs).length} Substitution(s)`}
              </button>
            </div>
          )}

          {message && Object.keys(pendingSubs).length === 0 && (
            <p className={message.startsWith('Error') ? 'error-msg' : 'success-msg'}>
              {message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
