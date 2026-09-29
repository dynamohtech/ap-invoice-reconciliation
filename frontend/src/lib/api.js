// ---------------------------------------------------------------------
// API layer for the AP reconciliation frontend.
//
// The contract below is implemented by the real backend (../backend) and
// by reference-server/, a small Express stand-in for testing this
// frontend without Docker or PostgreSQL. If you change a route here,
// change it in both places.
//
// Mode is controlled by VITE_API_BASE_URL (see .env.example):
//   - unset  -> runs entirely against in-memory mock data (default)
//   - set    -> calls `${VITE_API_BASE_URL}/api/...` for real
//
// Contract:
//   POST /api/auth/login                 { username, password }
//   GET  /api/auth/me
//   POST /api/auth/logout
//   GET  /api/dashboard/stats
//   GET  /api/invoices?subsidiary=&erp_source=&severity=&status=&vendor=
//   GET  /api/invoices/filter-options
//   GET  /api/invoices/:id
//   POST /api/invoices/:id/approve       { comment }
//   POST /api/invoices/:id/reject        { reason, comment }
//   POST /api/invoices/:id/request-info  { comment }
//   POST /api/invoices/:id/comments      { note }
//   GET  /api/admin/users
//   PATCH /api/admin/users/:id           { role }
//   GET  /api/admin/subsidiary-erp-map
//   PUT  /api/admin/subsidiary-erp-map   { subsidiary, erp, confirmed }
//   GET  /api/reports/summary
//
// None of these write to Odoo or D365 — they only read/update the
// reconciliation record (stored in the app's own database). Approve
// and reject are recommendations for a human AP process, not triggers.
//
// Every route past /api/auth/login now requires a session — realFetch
// attaches whatever token is in localStorage as a Bearer header
// automatically. Mutating routes no longer take an `actor` field in the
// body (approve/reject/etc. never did; this now also covers the new
// admin routes) — real identity comes from that session token, not a
// client-supplied field. reference-server enforces this the same way
// ap-recon-service eventually needs to.
// ---------------------------------------------------------------------

import {
  MOCK_INVOICES,
  getMockInvoice,
  computeStats,
  filterInvoices,
  getFilterOptionsData,
  approveInMemory,
  rejectInMemory,
  requestInfoInMemory,
  addCommentInMemory,
} from "./mockData";
import {
  findUserByCredentials,
  findUserById,
  listUsers,
  updateUserRole as updateUserRoleInMemory,
  listSubsidiaryMap,
  upsertSubsidiaryMap as upsertSubsidiaryMapInMemory,
} from "./adminData";
import { computeReportsSummary } from "./reportsData";

export const USE_MOCK = !import.meta.env.VITE_API_BASE_URL;
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const TOKEN_KEY = "ap_recon_token";

function delay(ms = 350) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function realFetch(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) message = parsed.error;
    } catch {
      /* response wasn't JSON — fall back to raw text above */
    }
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

// ---- Auth ----

export async function login(username, password) {
  if (USE_MOCK) {
    await delay(200);
    const user = findUserByCredentials(username, password);
    if (!user) throw new Error("Invalid username or password.");
    return { token: `mock-token-${user.id}`, user };
  }
  return realFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function logout() {
  if (USE_MOCK) {
    await delay(100);
    return null;
  }
  return realFetch("/api/auth/logout", { method: "POST" });
}

export async function getCurrentUser() {
  if (USE_MOCK) {
    await delay(150);
    const token = localStorage.getItem(TOKEN_KEY) || "";
    const user = findUserById(token.replace("mock-token-", ""));
    if (!user) throw new Error("Session expired.");
    return user;
  }
  const { user } = await realFetch("/api/auth/me");
  return user;
}

// ---- Dashboard ----

export async function getDashboardStats() {
  if (USE_MOCK) {
    await delay();
    return computeStats(MOCK_INVOICES);
  }
  return realFetch("/api/dashboard/stats");
}

// ---- Review Queue ----

export async function getFilterOptions() {
  if (USE_MOCK) {
    await delay(100);
    return getFilterOptionsData();
  }
  return realFetch("/api/invoices/filter-options");
}

export async function getInvoices(filters = {}) {
  if (USE_MOCK) {
    await delay();
    return filterInvoices(MOCK_INVOICES, filters);
  }
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
  ).toString();
  return realFetch(`/api/invoices${qs ? `?${qs}` : ""}`);
}

// ---- Invoice detail ----

export async function getInvoiceById(id) {
  if (USE_MOCK) {
    await delay();
    const inv = getMockInvoice(id);
    if (!inv) throw new Error("Invoice not found");
    return inv;
  }
  return realFetch(`/api/invoices/${id}`);
}

// ---- Actions ----
// These only ever change the reconciliation record's own status + audit
// trail. None of them call Odoo, D365, or trigger payment: the app never writes
// to the ERPs or moves money.

export async function approveInvoice(id, { comment, actor } = {}) {
  if (USE_MOCK) {
    await delay();
    return approveInMemory(id, { comment, actor });
  }
  return realFetch(`/api/invoices/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  });
}

export async function rejectInvoice(id, { reason, comment, actor }) {
  if (!reason) throw new Error("A rejection reason is required.");
  if (USE_MOCK) {
    await delay();
    return rejectInMemory(id, { reason, comment, actor });
  }
  return realFetch(`/api/invoices/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason, comment }),
  });
}

export async function requestMoreInfo(id, { comment, actor }) {
  if (USE_MOCK) {
    await delay();
    return requestInfoInMemory(id, { comment, actor });
  }
  return realFetch(`/api/invoices/${id}/request-info`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  });
}

export async function addComment(id, note, actor) {
  if (USE_MOCK) {
    await delay(150);
    return addCommentInMemory(id, note, actor);
  }
  return realFetch(`/api/invoices/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

// ---- Admin: users ----

export async function getAdminUsers() {
  if (USE_MOCK) {
    await delay();
    return listUsers();
  }
  return realFetch("/api/admin/users");
}

export async function updateUserRole(id, role, actingUserId) {
  if (USE_MOCK) {
    await delay();
    return updateUserRoleInMemory(id, role, actingUserId);
  }
  // actingUserId intentionally not sent — the server derives it from the
  // session token, same principle as approve/reject's actor (see header).
  return realFetch(`/api/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

// ---- Admin: subsidiary -> ERP mapping ----

export async function getSubsidiaryMap() {
  if (USE_MOCK) {
    await delay();
    return listSubsidiaryMap();
  }
  return realFetch("/api/admin/subsidiary-erp-map");
}

export async function upsertSubsidiaryMap(subsidiary, erp, confirmed) {
  if (USE_MOCK) {
    await delay();
    return upsertSubsidiaryMapInMemory(subsidiary, erp, confirmed);
  }
  return realFetch("/api/admin/subsidiary-erp-map", {
    method: "PUT",
    body: JSON.stringify({ subsidiary, erp, confirmed }),
  });
}

// ---- Reports ----

export async function getReportsSummary() {
  if (USE_MOCK) {
    await delay();
    return computeReportsSummary(MOCK_INVOICES);
  }
  return realFetch("/api/reports/summary");
}
