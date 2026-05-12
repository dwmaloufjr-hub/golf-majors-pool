export default function Scoring() {
  return (
    <div className="scoring-page">
      <h1>Scoring System</h1>

      <div className="scoring-grid">
        <div className="scoring-card">
          <h2>Per-Hole Scoring</h2>
          <table className="scoring-table">
            <thead>
              <tr><th>Result</th><th>Points</th></tr>
            </thead>
            <tbody>
              <tr className="positive"><td>Double Eagle (Albatross)</td><td>+20</td></tr>
              <tr className="positive"><td>Eagle</td><td>+8</td></tr>
              <tr className="positive"><td>Birdie</td><td>+3</td></tr>
              <tr className="neutral"><td>Par</td><td>+0.5</td></tr>
              <tr className="negative"><td>Bogey</td><td>-0.5</td></tr>
              <tr className="negative"><td>Double Bogey</td><td>-1</td></tr>
              <tr className="negative"><td>Worse than Double Bogey</td><td>-1</td></tr>
            </tbody>
          </table>
          <p className="scoring-note">Missed Cut = 0 points for Rounds 3 &amp; 4</p>
        </div>

        <div className="scoring-card">
          <h2>Finish Bonuses</h2>
          <table className="scoring-table">
            <thead>
              <tr><th>Position</th><th>Bonus</th></tr>
            </thead>
            <tbody>
              <tr><td>1st</td><td>+30</td></tr>
              <tr><td>2nd</td><td>+20</td></tr>
              <tr><td>3rd</td><td>+18</td></tr>
              <tr><td>4th</td><td>+16</td></tr>
              <tr><td>5th</td><td>+14</td></tr>
              <tr><td>6th</td><td>+12</td></tr>
              <tr><td>7th</td><td>+10</td></tr>
              <tr><td>8th</td><td>+9</td></tr>
              <tr><td>9th</td><td>+8</td></tr>
              <tr><td>10th</td><td>+7</td></tr>
              <tr><td>11th–15th</td><td>+6</td></tr>
              <tr><td>16th–20th</td><td>+5</td></tr>
              <tr><td>21st–25th</td><td>+4</td></tr>
              <tr><td>26th–30th</td><td>+3</td></tr>
              <tr><td>31st–40th</td><td>+2</td></tr>
              <tr><td>41st–50th</td><td>+1</td></tr>
            </tbody>
          </table>
        </div>

        <div className="scoring-card">
          <h2>Streak Bonuses</h2>
          <table className="scoring-table">
            <thead>
              <tr><th>Achievement</th><th>Bonus</th></tr>
            </thead>
            <tbody>
              <tr><td>3+ Birdie Streak</td><td>+3</td></tr>
              <tr><td>Bogey-Free Round</td><td>+3</td></tr>
              <tr><td>Hole in One</td><td>+10</td></tr>
            </tbody>
          </table>
          <p className="scoring-note">Birdie streak bonus: max 1 per round</p>
        </div>

        <div className="scoring-card">
          <h2>Draft Rules</h2>
          <ul className="rules-list">
            <li><strong>$100 budget</strong> per entrant</li>
            <li>Buy as many players as your budget allows</li>
            <li>Multiple entrants can own the same player</li>
            <li>Blind draft — rosters revealed at deadline</li>
            <li>Player prices locked at Masters odds</li>
          </ul>
        </div>

        <div className="scoring-card">
          <h2>Substitutions</h2>
          <ul className="rules-list">
            <li>Allowed when a player is not in a tournament field or withdraws before Round 1</li>
            <li>Sub must cost <strong>equal to or less</strong> than the original player's price</li>
            <li>Subs are tournament-only — original player returns next major</li>
            <li>Mid-tournament withdrawal: no sub allowed, player keeps earned points</li>
            <li>Sub deadline: 24 hours before Round 1</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
