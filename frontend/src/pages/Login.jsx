import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { LogIn, FlaskConical } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { USE_MOCK } from "../lib/api";
import { DEMO_USERS } from "../lib/adminData";
import { ROLE_LABEL } from "../lib/status";

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to={location.state?.from || "/dashboard"} replace />;
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate(location.state?.from || "/dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="wordmark">
          Acme <span>AP Reconciliation</span>
        </div>

        <label htmlFor="login-username">Username</label>
        <input
          id="login-username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />

        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="login-error">{error}</p>}

        <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
          <LogIn size={15} /> {busy ? "Signing in…" : "Sign in"}
        </button>

        {USE_MOCK && (
          <div className="login-demo-hint">
            <FlaskConical size={12} />
            <div>
              Demo mode — any account below, password <code>demo1234</code>:
              <ul>
                {DEMO_USERS.map((u) => (
                  <li key={u.id}>
                    <code>{u.username}</code> — {ROLE_LABEL[u.role]}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
