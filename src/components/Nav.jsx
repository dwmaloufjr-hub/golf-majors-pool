import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Nav() {
  const { profile, signOut } = useAuth();

  return (
    <nav className="main-nav">
      <div className="nav-brand">
        <NavLink to="/">⛳ Majors Pool</NavLink>
      </div>
      <div className="nav-links">
        <NavLink to="/">Leaderboard</NavLink>
        <NavLink to="/draft">Draft</NavLink>
        <NavLink to="/rosters">Rosters</NavLink>
        <NavLink to="/subs">Subs</NavLink>
      </div>
      <div className="nav-user">
        {profile && (
          <>
            <span className="user-name">{profile.display_name}</span>
            <button onClick={signOut} className="sign-out-btn">Sign Out</button>
          </>
        )}
      </div>
    </nav>
  );
}
