import { createContext, useContext, useEffect, useState } from "react";
import { login as apiLogin, logout as apiLogout, getCurrentUser } from "../lib/api";

// Real session-based auth. Replaces the old client-side role switcher —
// see git history if you need the old version. The token lives in
// localStorage: this is a standalone app (npm run dev / a built bundle),
// so ordinary browser storage is the right tool here.
//
// Mock mode fakes the same token/user shape entirely client-side (see
// src/lib/adminData.js + src/lib/api.js) so this context doesn't need
// to know which mode it's in — it just calls login()/logout()/
// getCurrentUser() from lib/api and stores whatever comes back.
//
// Server-side enforcement: reference-server/server.js checks this same
// bearer token on every /api/* route and derives the acting user from
// it — actor identity no longer comes from the client on mutating
// requests. ap-recon-service needs the equivalent middleware before
// this can be pointed at it for real; role-gating here (canApprove,
// canComment, and the route guards in RouteGuards.jsx) is still a UX
// convenience on top of that, not the actual control.

const TOKEN_KEY = "ap_recon_token";
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    getCurrentUser()
      .then(setUser)
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(username, password) {
    const { token, user: loggedInUser } = await apiLogin(username, password);
    localStorage.setItem(TOKEN_KEY, token);
    setUser(loggedInUser);
    return loggedInUser;
  }

  async function logout() {
    await apiLogout().catch(() => {
      /* best effort — clear local state regardless */
    });
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }

  const value = {
    user,
    loading,
    login,
    logout,
    canApprove: user?.role === "approver",
    canComment: user?.role === "reviewer" || user?.role === "approver",
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
