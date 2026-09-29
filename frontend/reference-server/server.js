// ---------------------------------------------------------------------
// Reference implementation of the contract documented in
// ../src/lib/api.js and ../README.md.
//
// This is NOT ap-recon-service. It exists to:
//   1. Let this frontend be tested against a real HTTP backend, not just
//      in-memory mock data inside the browser tab.
//   2. Give whoever builds the real routes on ap-recon-service a working,
//      runnable example of the shapes this frontend expects.
//
// State is in-memory (imported straight from src/lib/mockData.js and
// src/lib/adminData.js) and resets on restart.
//
// Auth added: a real (if minimal) session layer — login issues an
// opaque bearer token held in an in-memory Map, every route past
// /api/auth/login requires it, and the acting user for approve/reject/
// comment/etc. now comes from that session instead of a client-supplied
// field or the old hardcoded placeholder actor. This is exactly what
// the comment in api.js was waiting on. Passwords are plaintext demo
// values in adminData.js — fine for a POC, not how ap-recon-service
// should do it for real (see that file's own header comment).
//
// Run: npm install && npm start   (defaults to http://localhost:3001)
// ---------------------------------------------------------------------

import crypto from "node:crypto";
import express from "express";
import cors from "cors";
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
} from "../src/lib/mockData.js";
import {
  findUserByCredentials,
  findUserById,
  listUsers,
  updateUserRole,
  listSubsidiaryMap,
  upsertSubsidiaryMap,
} from "../src/lib/adminData.js";
import { computeReportsSummary } from "../src/lib/reportsData.js";

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

// ---- Auth ----

const sessions = new Map(); // token -> userId, resets on restart

function issueToken(userId) {
  const token = crypto.randomUUID();
  sessions.set(token, userId);
  return token;
}

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = findUserByCredentials(username, password);
  if (!user) return res.status(401).json({ error: "Invalid username or password." });
  res.json({ token: issueToken(user.id), user });
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const userId = token && sessions.get(token);
  if (!userId) return res.status(401).json({ error: "Not authenticated." });
  const user = findUserById(userId);
  if (!user) return res.status(401).json({ error: "Not authenticated." });
  req.user = user;
  req.token = token;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires one of: ${roles.join(", ")}.` });
    }
    next();
  };
}

// Everything below this line requires a valid session.
app.use(requireAuth);

app.get("/api/auth/me", (req, res) => res.json({ user: req.user }));

app.post("/api/auth/logout", (req, res) => {
  sessions.delete(req.token);
  res.status(204).end();
});

// ---- Dashboard / invoices (same shapes as before, now behind auth) ----

app.get("/api/dashboard/stats", (req, res) => {
  res.json(computeStats(MOCK_INVOICES));
});

app.get("/api/invoices/filter-options", (req, res) => {
  res.json(getFilterOptionsData());
});

app.get("/api/invoices", (req, res) => {
  res.json(filterInvoices(MOCK_INVOICES, req.query));
});

app.get("/api/invoices/:id", (req, res) => {
  const inv = getMockInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  res.json(inv);
});

app.post("/api/invoices/:id/approve", (req, res) => {
  const inv = approveInMemory(req.params.id, { comment: req.body.comment, actor: req.user });
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  res.json(inv);
});

app.post("/api/invoices/:id/reject", (req, res) => {
  if (!req.body.reason) return res.status(400).json({ error: "A rejection reason is required." });
  const inv = rejectInMemory(req.params.id, {
    reason: req.body.reason,
    comment: req.body.comment,
    actor: req.user,
  });
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  res.json(inv);
});

app.post("/api/invoices/:id/request-info", (req, res) => {
  const inv = requestInfoInMemory(req.params.id, { comment: req.body.comment, actor: req.user });
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  res.json(inv);
});

app.post("/api/invoices/:id/comments", (req, res) => {
  const inv = addCommentInMemory(req.params.id, req.body.note, req.user);
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  res.json(inv);
});

// ---- Admin ----

app.get("/api/admin/users", requireRole("system_admin", "auditor"), (req, res) => {
  res.json(listUsers());
});

app.patch("/api/admin/users/:id", requireRole("system_admin"), (req, res) => {
  try {
    const updated = updateUserRole(req.params.id, req.body.role, req.user.id);
    if (!updated) return res.status(404).json({ error: "User not found." });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/admin/subsidiary-erp-map", requireRole("system_admin", "auditor"), (req, res) => {
  res.json(listSubsidiaryMap());
});

app.put("/api/admin/subsidiary-erp-map", requireRole("system_admin"), (req, res) => {
  try {
    const row = upsertSubsidiaryMap(req.body.subsidiary, req.body.erp, req.body.confirmed);
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Reports ----
// No role restriction — none is needed, and
// unlike admin/user data there's nothing here a Reviewer or Approver
// shouldn't see.

app.get("/api/reports/summary", (req, res) => {
  res.json(computeReportsSummary(MOCK_INVOICES));
});

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

app.listen(PORT, () => {
  console.log(`Reference server (NOT ap-recon-service) listening on http://localhost:${PORT}`);
});
