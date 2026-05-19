import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgot, setIsForgot] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, resetPassword } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isForgot) {
        await resetPassword(email);
        setMessage('Check your email for a password reset link.');
      } else if (isSignUp) {
        await signUp(email, password, displayName);
        navigate('/');
      } else {
        await signIn(email, password);
        navigate('/');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>⛳ Eas'mo Majors Pool 2026</h1>
        <h2>{isForgot ? 'Reset Password' : isSignUp ? 'Create Account' : 'Sign In'}</h2>

        {error && <div className="error-msg">{error}</div>}
        {message && <div className="success-msg">{message}</div>}

        <form onSubmit={handleSubmit}>
          {isSignUp && !isForgot && (
            <input
              type="text"
              placeholder="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {!isForgot && (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          )}
          <button type="submit" disabled={loading}>
            {loading
              ? 'Loading...'
              : isForgot
                ? 'Send Reset Link'
                : isSignUp
                  ? 'Sign Up'
                  : 'Sign In'}
          </button>
        </form>

        {!isSignUp && !isForgot && (
          <p className="forgot-password">
            <button type="button" onClick={() => { setIsForgot(true); setError(''); setMessage(''); }}>
              Forgot password?
            </button>
          </p>
        )}

        {isForgot ? (
          <p className="toggle-auth">
            <button type="button" onClick={() => { setIsForgot(false); setError(''); setMessage(''); }}>
              Back to Sign In
            </button>
          </p>
        ) : (
          <p className="toggle-auth">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button type="button" onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage(''); }}>
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
