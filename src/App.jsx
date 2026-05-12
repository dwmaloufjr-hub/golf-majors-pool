import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Nav from './components/Nav';
import Login from './pages/Login';
import Draft from './pages/Draft';
import Leaderboard from './pages/Leaderboard';
import Rosters from './pages/Rosters';
import Substitutions from './pages/Substitutions';
import Scoring from './pages/Scoring';

function AppLayout({ children }) {
  return (
    <>
      <Nav />
      <main className="main-content">{children}</main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout><Leaderboard /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/draft"
            element={
              <ProtectedRoute>
                <AppLayout><Draft /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/rosters"
            element={
              <ProtectedRoute>
                <AppLayout><Rosters /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/subs"
            element={
              <ProtectedRoute>
                <AppLayout><Substitutions /></AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/scoring"
            element={
              <ProtectedRoute>
                <AppLayout><Scoring /></AppLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
