# AP Reconciliation — Frontend

Core screens for the AP invoice reconciliation app: **Dashboard**, **Review Queue**, **Invoice Review**,
**Admin** (users/roles + subsidiary→ERP mapping) with real login, and now
**Reports** (discrepancy rates, resolution time, resend frequency).
Vendor & Tolerance Manager, the standalone Audit Trail screen, and the
Blurry/Resend Tracker are still open — see "What's genuinely open" below.

## Run it

```
npm install
npm run dev
```

Opens against **in-memory mock data** by default — nothing to configure.
You'll land on a login screen; the mock-mode hint on that screen lists five
demo accounts (one per role, password `demo1234` for all). Twelve synthetic
invoices across Acme Fresh (Odoo) and Acme Stores (D365) are generated in
`src/lib/mockData.js`, covering pending/approved/rejected/blurry states and
all three severities.

Log out and back in as a different demo account to see how the screens
change by role — Approve/Reject only works as Approver, and the Admin nav
link only shows for System Admin / Auditor.

## Testing this against a real HTTP backend

`reference-server/` is a small Express app implementing the exact contract
below, sharing the same data/logic as the frontend's mock mode (both import
from `src/lib/mockData.js` and `src/lib/adminData.js` — one source of truth,
not copies that can drift apart). It is **not** the real backend (`../backend`): it's a lightweight
stand-in for testing this frontend end to end without Docker or PostgreSQL.

```
cd reference-server
npm install
npm start                     # http://localhost:3001

# in the frontend folder, in another terminal:
echo "VITE_API_BASE_URL=http://localhost:3001" > .env
npm run dev
```

Every route was exercised directly, this round with a real session in play:
unauthenticated request rejected, wrong-password login rejected, login
issuing a working bearer token, `/me` round-tripping it, a non-admin role
getting a 403 on `/api/admin/*`, a System Admin blocked from editing their
own role, a role edit taking effect immediately, an Auditor able to read
admin data but not write it, an approve going through with the *real*
logged-in user's name in the activity trail (not a hardcoded placeholder),
logout killing the token, and the existing approve/reject/request-info/
comments/filtering/404 paths from before, all still passing. `/api/reports/summary`
was checked the same way, then its actual numbers were hand-verified against
the mock data (e.g. resolution-time-by-subsidiary averages reconstruct the
overall average exactly) rather than just checking the HTTP status came back
200. A build with `VITE_API_BASE_URL` set was also confirmed to compile and
bake the real URL into the bundle. What that does **not** cover: clicking
through the actual UI in a real browser against this server.

## Pointing this at the real backend

Everything goes through `src/lib/api.js`. Start the backend in `../backend`
(see its README), then set `VITE_API_BASE_URL=http://localhost:3001` (see
`.env.example`) and the app switches from mock data to real `fetch` calls.
Both the backend and `reference-server/` implement these routes:

```
POST /api/auth/login                 { username, password }
GET  /api/auth/me
POST /api/auth/logout
GET  /api/dashboard/stats
GET  /api/invoices?subsidiary=&erp_source=&severity=&status=&vendor=
GET  /api/invoices/:id
POST /api/invoices/:id/approve       { comment }
POST /api/invoices/:id/reject        { reason, comment }
POST /api/invoices/:id/request-info  { comment }
POST /api/invoices/:id/comments      { note }
GET  /api/invoices/filter-options
GET  /api/admin/users                                 (system_admin, auditor)
PATCH /api/admin/users/:id           { role }          (system_admin only)
GET  /api/admin/subsidiary-erp-map                     (system_admin, auditor)
PUT  /api/admin/subsidiary-erp-map   { subsidiary, erp, confirmed }  (system_admin only)
GET  /api/reports/summary
```

None of these write to Odoo or D365 — they only read/update the
reconciliation record. Approve and Reject are recommendations for a human
process, never a trigger. That's enforced by omission: no ERP-write call
exists anywhere in the frontend or the backend.

**Every route above except `/api/auth/login` now expects a session.**
`realFetch` in `src/lib/api.js` attaches whatever token is in
`localStorage` as `Authorization: Bearer <token>` automatically. None of
the mutating routes take an `actor` or `actingUserId` in the request body
— identity comes from that session token server-side (see `requireAuth` /
`requireRole` in `reference-server/server.js`), not a client-supplied
field. The backend implements this properly: bcrypt-hashed passwords,
expiring session tokens and role middleware. `reference-server`'s version
(opaque token in an in-memory `Map`, plaintext demo passwords) is
intentionally minimal and is not a security design to carry over as-is.

## What's still open

- **Auth in mock mode and `reference-server` is demo-only.** Passwords are
  plaintext demo values (`src/lib/adminData.js`). The backend hashes
  passwords and expires sessions, but there's no SSO or real user
  provisioning yet.
- **Subsidiary-scoped RBAC is still an open question.** Users have no
  enforced `subsidiary` field — whether an Acme Fresh Reviewer should only
  see Acme Fresh invoices, vs. everyone seeing a consolidated group view, is
  still to be decided with the finance team. Nothing here assumes an answer either way.
- **Click-to-verify (bounding boxes) isn't built.** Unchanged from before —
  a vision-LLM extraction doesn't return word coordinates by default, so
  there's nothing to click through to yet. Still a placeholder schematic.
- **D365 price field is unconfirmed.** Unchanged — `ComparisonPanel` still
  shows the standing caveat; don't trust D365 price columns until
  `find-d365-entity.js` has run against the real tenant.
- **Subsidiary → ERP mapping now has a real place to live** (the Admin
  screen), but the data in it is still a demo seed: Acme Fresh/Odoo
  confirmed, Acme Stores left "Not yet confirmed" by default in
  `src/lib/adminData.js` regardless of what the mock invoice data
  illustrates for Path B. Confirming it for real happens on the Admin
  screen, per deployment.
- **Reports reads "resend frequency by sender" as by-vendor.** It isn't
  settled whether the sender is the vendor or a store/subsidiary
  relaying the scan — `src/lib/reportsData.js` groups by `vendor_name`
  since that's the field the extraction schema actually populates. Worth
  a second look once the real intake channel exists and
  "sender" has one concrete meaning. Also flagged inline on the screen
  itself, not just here.
- **Not built at all yet:** Vendor & Tolerance Manager, the full standalone
  Audit Trail screen (per-invoice activity exists on Invoice Review; the
  cross-invoice screen doesn't), Blurry/Resend Tracker as its own screen,
  and the Path 2 "touchless" auto-approval logic — every mock invoice here
  still sits in a human queue regardless of severity.

## Stack notes

React 19 + Vite, plain CSS (no Tailwind — kept dependencies minimal and
gave full control over the visual design), `react-router-dom` for routing,
`lucide-react` for icons. No TypeScript, matching the backend's plain-JS
convention. The session token lives in `localStorage` (see
`src/auth/AuthContext.jsx`).
