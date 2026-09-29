import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { FlaskConical, LogOut } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { USE_MOCK } from "../lib/api";
import { ROLE_LABEL } from "../lib/status";

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function doLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const canSeeAdmin = user.role === "system_admin" || user.role === "auditor";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="wordmark">
          Acme <span>AP Reconciliation</span>
        </div>
        <nav className="topnav">
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "active" : "")}>
            Dashboard
          </NavLink>
          <NavLink to="/queue" className={({ isActive }) => (isActive ? "active" : "")}>
            Review Queue
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => (isActive ? "active" : "")}>
            Reports
          </NavLink>
          {canSeeAdmin && (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "")}>
              Admin
            </NavLink>
          )}
        </nav>
        {USE_MOCK && (
          <span
            className="badge neutral"
            title="Running against synthetic in-memory data — see README"
          >
            <FlaskConical size={12} /> Demo data
          </span>
        )}
        <div className="user-chip">
          <span className="user-chip-name">{user.name}</span>
          <span className="user-chip-role">{ROLE_LABEL[user.role] || user.role}</span>
          <button className="btn btn-ghost" onClick={doLogout} title="Sign out">
            <LogOut size={14} />
          </button>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
