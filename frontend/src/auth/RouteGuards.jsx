import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

// Client-side gates only — a UX convenience so the wrong screens don't
// even render, not the real control. ap-recon-service needs the same
// checks server-side (see AuthContext.jsx header) before this means
// anything against real data.

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="text-secondary">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

// Assumes it only ever renders inside RequireAuth, so `user` is set.
export function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}
