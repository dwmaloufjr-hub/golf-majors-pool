import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function Leaderboard() {
  const [standings, setStandings] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState('all');
  const [expandedUser, setExpandedUser] = useState(null);
  const [tournamentPlayers, setTournamentPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draftRevealed, setDraftRevealed] = useState(false);
  const { profile } = useAuth();

  useEffect(() => {
    checkDraftDeadline();
    fetchTournaments();
    fetchStandings();
  }, []);

  async function checkDraftDeadline() {
    const { data: masters } = await supabase
      .from('tournaments')
      .select('draft_deadline')
      .eq('name', 'Masters')
      .single();

    if (masters?.draft_deadline && new Date() > new Date(masters.draft_deadline)) {
      setDraftRevealed(true);
    }
  }

  async function fetchTournaments() {
    const { data } = await supabase
      .from('tournaments')
      .select('*')
      .order('start_date');
    setTournaments(data || []);
  }

  async function fetchStandings() {
    setLoading(true);

    const { data: users } = await supabase
      .from('users')
      .select('id, display_name');

    if (!users) {
      setLoading(false);
      return;
    }

    const { data: rosters } = await supabase
      .from('rosters')
      .select('*, player:players(*)');

    const { data: tpData } = await supabase
      .from('tournament_players')
      .select('*');

    // Fetch scores to calculate holes played per player per tournament
    const { data: scoresData } = await supabase
      .from('scores')
      .select('tournament_id, player_id, round, hole');

    // Build playerThru: { `${tournamentId}-${playerId}`: holesPlayed }
    const playerThru = {};
    (scoresData || []).forEach((s) => {
      const key = `${s.tournament_id}-${s.player_id}`;
      playerThru[key] = (playerThru[key] || 0) + 1;
    });

    setTournamentPlayers(tpData || []);

    const userStandings = users.map((u) => {
      const userRoster = (rosters || []).filter((r) => r.user_id === u.id);

      // Build effective roster per tournament (original + subs)
      const originalPicks = userRoster.filter((r) => !r.is_sub);
      const subs = userRoster.filter((r) => r.is_sub);

      // For each tournament, determine which players contribute points
      const playerIds = [...new Set(userRoster.map((r) => r.player_id))];

      let totalPoints = 0;
      const tournamentBreakdown = {};
      const playerPoints = {}; // playerId -> { total, perTournament }

      (tpData || []).forEach((tp) => {
        if (playerIds.includes(tp.player_id)) {
          const pts = Number(tp.total_points || 0);
          totalPoints += pts;

          if (!tournamentBreakdown[tp.tournament_id]) {
            tournamentBreakdown[tp.tournament_id] = 0;
          }
          tournamentBreakdown[tp.tournament_id] += pts;

          if (!playerPoints[tp.player_id]) {
            playerPoints[tp.player_id] = { total: 0, byTournament: {}, thruByTournament: {} };
          }
          playerPoints[tp.player_id].total += pts;
          playerPoints[tp.player_id].byTournament[tp.tournament_id] = pts;
          playerPoints[tp.player_id].thruByTournament[tp.tournament_id] =
            playerThru[`${tp.tournament_id}-${tp.player_id}`] || 0;
        }
      });

      return {
        ...u,
        roster: userRoster,
        originalPicks,
        subs,
        totalPoints,
        tournamentBreakdown,
        playerPoints,
        playerCount: originalPicks.length,
      };
    });

    userStandings.sort((a, b) => b.totalPoints - a.totalPoints);
    setStandings(userStandings);
    setLoading(false);
  }

  if (loading) return <div className="loading">Loading standings...</div>;

  return (
    <div className="leaderboard-page">
      <h1>Pool Standings</h1>

      <div className="tournament-filter">
        <button
          className={selectedTournament === 'all' ? 'active' : ''}
          onClick={() => setSelectedTournament('all')}
        >
          Overall
        </button>
        {tournaments.map((t) => (
          <button
            key={t.id}
            className={selectedTournament === t.id ? 'active' : ''}
            onClick={() => setSelectedTournament(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>

      {standings.length === 0 ? (
        <div className="draft-locked">
          <h2>No Entries Yet</h2>
          <p>Standings will appear once players submit rosters and tournaments begin.</p>
        </div>
      ) : (
        <div className="standings-table">
          <div className="standings-header">
            <span className="rank">#</span>
            <span className="name">Entrant</span>
            <span className="players-count">Roster</span>
            <span className="points">Points</span>
          </div>
          {standings.map((entry, i) => {
            const points =
              selectedTournament === 'all'
                ? entry.totalPoints
                : entry.tournamentBreakdown[selectedTournament] || 0;

            return (
              <div key={entry.id}>
                <div
                  className={`standings-row ${expandedUser === entry.id ? 'expanded' : ''} ${!draftRevealed && entry.id !== profile?.id ? 'no-expand' : ''}`}
                  onClick={() => {
                    if (!draftRevealed && entry.id !== profile?.id) return;
                    setExpandedUser(expandedUser === entry.id ? null : entry.id);
                  }}
                >
                  <span className="rank">{i + 1}</span>
                  <span className="name">{entry.display_name}</span>
                  <span className="players-count">
                    {draftRevealed || entry.id === profile?.id ? entry.playerCount : '?'}
                  </span>
                  <span className="points">{points.toFixed(1)}</span>
                </div>

                {expandedUser === entry.id && (draftRevealed || entry.id === profile?.id) && (
                  <div className="roster-detail">
                    {entry.originalPicks
                      .sort((a, b) => (b.player?.price || 0) - (a.player?.price || 0))
                      .map((r) => {
                        const pp = entry.playerPoints[r.player_id];
                        const playerPts =
                          selectedTournament === 'all'
                            ? pp?.total || 0
                            : pp?.byTournament[selectedTournament] || 0;

                        // Calculate total holes played across tournaments
                        const playerHolesThru =
                          selectedTournament === 'all'
                            ? Object.values(pp?.thruByTournament || {}).reduce((a, b) => a + b, 0)
                            : pp?.thruByTournament?.[selectedTournament] || 0;

                        // Find tournament_player data for position info
                        const tpInfo = selectedTournament !== 'all'
                          ? tournamentPlayers.find(
                              (tp) =>
                                tp.player_id === r.player_id &&
                                tp.tournament_id === selectedTournament
                            )
                          : null;

                        return (
                          <div key={r.id} className="roster-detail-row">
                            <span className="detail-name">
                              {r.player?.name}
                              {tpInfo?.finish_position && (
                                <span className="detail-pos">
                                  {' '}T{tpInfo.finish_position}
                                </span>
                              )}
                              {tpInfo?.cut_made === false && (
                                <span className="detail-mc"> MC</span>
                              )}
                            </span>
                            <span className="detail-right">
                              <span className="detail-price">${r.player?.price}</span>
                              <span className={`detail-points ${playerPts > 0 ? 'positive' : playerPts < 0 ? 'negative' : ''}`}>
                                {playerPts > 0 ? '+' : ''}{playerPts.toFixed(1)}
                                {playerHolesThru > 0 && (
                                  <span className="detail-thru"> thru {playerHolesThru}</span>
                                )}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    {entry.subs.length > 0 && (
                      <>
                        <div className="roster-detail-divider">Subs</div>
                        {entry.subs.map((r) => {
                          const pp = entry.playerPoints[r.player_id];
                          const playerPts =
                            selectedTournament === 'all'
                              ? pp?.total || 0
                              : pp?.byTournament[selectedTournament] || 0;

                          const tournamentName = tournaments.find(
                            (t) => t.id === r.tournament_id
                          )?.name;

                          return (
                            <div key={r.id} className="roster-detail-row sub-row">
                              <span className="detail-name">
                                {r.player?.name}
                                <span className="detail-sub-label">
                                  {' '}({tournamentName})
                                </span>
                              </span>
                              <span className="detail-right">
                                <span className="detail-price">${r.player?.price}</span>
                                <span className={`detail-points ${playerPts > 0 ? 'positive' : playerPts < 0 ? 'negative' : ''}`}>
                                  {playerPts > 0 ? '+' : ''}{playerPts.toFixed(1)}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
