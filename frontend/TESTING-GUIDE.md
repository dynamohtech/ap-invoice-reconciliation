# Frontend Test Guide — No Backend Required

Every number in this guide was pulled by actually running the code against
the real mock data (`src/lib/mockData.js` + `src/lib/adminData.js`), not
estimated. If what you see on screen doesn't match a number here, that's a
real bug, not a documentation gap — see "If something doesn't match" at the
bottom.

## How this app gets its data, in plain terms

There is no backend in this test. `src/lib/api.js` has a mock/real switch:
if the environment variable `VITE_API_BASE_URL` is **not** set, every
"API call" the app makes is actually a function call straight into
`src/lib/mockData.js` / `src/lib/adminData.js` / `src/lib/reportsData.js`,
running in your browser tab. Twelve invoices, five users, and a
subsidiary→ERP mapping are already sitting in those files — nothing needs
to be fed in manually, and there's no server to start for this test.

**One consequence of that worth knowing before you start:** all of that
data lives in memory in the browser tab. If you refresh the page, it
resets to the original seed values below — any role you changed, any
invoice you approved, any mapping you edited goes back to how it started.
That's expected in mock mode, not a bug. Test a given change and look at
its effect *before* refreshing.

## 0. Setup

```
npm install
npm run dev
```

Open the URL it prints — normally `http://localhost:5173`. If the very
first page load hangs, refresh once; Vite sometimes stalls the first
request while it pre-bundles dependencies on a cold start, and that's the
only known quirk unrelated to this app's own code.

You should land on a **login screen**, not the dashboard. If you land
anywhere else, stop here and report it.

## 1. Demo accounts

Password is `demo1234` for all five — also shown on the login screen itself.

| Username | Role | Can do |
|---|---|---|
| `reviewer` | Reviewer | View invoices, comment. Cannot approve/reject. No Admin access. |
| `approver` | Approver | Everything Reviewer can, plus Approve/Reject. No Admin access. |
| `vendor_admin` | Vendor & Tolerance Admin | Same visibility as Reviewer today (this role's own screen isn't built yet). No Admin access. |
| `auditor` | Auditor | Read-only everywhere, **including** the Admin screen. |
| `admin` | System Admin | Full Admin screen access (edit roles, edit the subsidiary mapping). Cannot approve/reject invoices. |

- [ ] All five log in successfully with `demo1234`
- [ ] A wrong password (try `admin` / `wrong`) shows an error message and does not log you in

## 2. Dashboard — expected numbers

Log in as `admin` (sees everything) and check the four top counts:

| Stat | Expected |
|---|---|
| Pending review | **6** |
| Approved today | **1** |
| Rejected | **2** |
| Awaiting resend (blurry) | **2** |

Breakdown by subsidiary: **Acme Fresh 7**, **Acme Stores 5** (total 12).
Breakdown by ERP source: **Odoo 7**, **D365 5**.

- [ ] All four numbers above match what's on screen
- [ ] Clicking a stat card jumps to the Review Queue, pre-filtered to match it

## 3. Review Queue — the full invoice list

All 12 invoices, exactly as seeded. Use this table to cross-check what's on
screen — vendor, subsidiary, ERP, status, and match severity for every row:

| ID | Invoice # | Vendor | Subsidiary | ERP | Status | Severity |
|---|---|---|---|---|---|---|
| inv_001 | INV-2026-3381 | Delta Meats Supply Co. | Acme Fresh | Odoo | Pending review | Matched |
| inv_002 | INV-2026-3390 | Northgate Livestock Distributors Ltd | Acme Fresh | Odoo | Pending review | Within tolerance |
| inv_003 | INV-2026-3352 | Yaba Packaging Nig. Ltd | Acme Fresh | Odoo | Pending review | Mismatch |
| inv_004 | INV-2026-3398 | Emeka & Sons Trading Co. | Acme Fresh | Odoo | **Approved** | Matched |
| inv_005 | INV-2026-3301 | Delta Meats Supply Co. | Acme Fresh | Odoo | **Rejected** | Mismatch |
| inv_006 | AS-INV-9021 | Coastal Beverages Plc | Acme Stores | D365 | Pending review | Matched |
| inv_007 | AS-INV-9034 | Highland Dairy Nigeria Ltd | Acme Stores | D365 | Pending review | Mismatch |
| inv_008 | AS-INV-9040 | Ilesha Fresh Produce Ltd | Acme Stores | D365 | **Approved** | Within tolerance |
| inv_009 | AS-INV-9052 | Adaeze Foods Ltd | Acme Stores | D365 | **Unreadable** | — |
| inv_010 | INV-2026-3405 | Northgate Livestock Distributors Ltd | Acme Fresh | Odoo | **Unreadable** | — |
| inv_011 | INV-2026-3298 | Yaba Packaging Nig. Ltd | Acme Fresh | Odoo | Pending review | Mismatch |
| inv_012 | AS-INV-8988 | Coastal Beverages Plc | Acme Stores | D365 | **Rejected** | Mismatch |

Tally: 3 matched, 2 within tolerance, 5 mismatch, 2 unreadable = 12.

- [ ] Filter by subsidiary = Acme Fresh → **7 rows**
- [ ] Filter by subsidiary = Acme Stores → **5 rows**
- [ ] Filter by severity = Mismatch → **5 rows** (inv_003, inv_005, inv_007, inv_011, inv_012)
- [ ] Clicking any row opens that invoice's Invoice Review screen

## 4. Invoice Review — four specific invoices to open

**inv_002 (within tolerance)** — Northgate Livestock Distributors Ltd
- Extracted total: **₦736,375.00** (subtotal 685,000 + tax 51,375)
- Two line items: Goat meat bone-in (150 × ₦3,900) and Packaging crates (40 × ₦2,500)
- No discrepancies listed, but severity badge should read "Within tolerance," not "Matched"

**inv_011 (mismatch)** — Yaba Packaging Nig. Ltd
- Should show exactly two discrepancy lines:
  - `Price mismatch on Cling film rolls: invoice=1900.00, bill=1700.00`
  - `Total mismatch: invoice=204250.00, Odoo bill=182750.00`
- Price field should render red (mismatch), not amber

**inv_009 (unreadable / blurry)** — Adaeze Foods Ltd
- Extracted fields should all show as empty/null — no line items, no totals
- Activity log's only entry: *"Invoice received. Flagged unreadable before extraction — resend requested from sender automatically."*
- Approve/Reject shouldn't make sense to use here — check what the screen actually does with the action buttons in this state

**inv_004 (already approved)** — Emeka & Sons Trading Co.
- Activity log has 2 entries: intake, then an approval on 2026-09-03 by **Jordan A.**, noted *"Approved. No mismatch outside tolerance."*
- Log in as `approver` and open it — Approve/Reject should reflect that this is already decided, not offer to approve it again

- [ ] All four match the above
- [ ] The document pane on the left shows a schematic reconstruction, not a real scanned image (expected — this is a known placeholder)

## 5. Role-gating on actions

- [ ] Log in as `reviewer`, open any pending invoice (e.g. inv_001): Approve/Reject are disabled or absent; a comment can still be posted
- [ ] Log in as `approver`, open inv_001: Approve/Reject are active
- [ ] Approve inv_001 as `approver`, add a comment first — Activity should show **your** name (Jordan A.) and role, not a placeholder
- [ ] Reject something (e.g. inv_003) without typing a reason — should be blocked; typing a reason should let it through

## 6. Admin screen (log in as `admin`)

**Users & roles** — exactly these 5 rows on load:

| Name | Username | Role |
|---|---|---|
| Dana R. | reviewer | Reviewer |
| Jordan A. | approver | Approver |
| Morgan F. | vendor_admin | Vendor & Tolerance Admin |
| Casey N. | auditor | Auditor |
| IT Admin | admin | System Admin |

- [ ] Your own row (IT Admin) has a locked role dropdown with a lock icon — you can't change your own role
- [ ] Changing Dana R.'s role to something else works and updates immediately

**Subsidiary → ERP mapping** — exactly these 2 rows on load:

| Subsidiary | ERP | Status |
|---|---|---|
| Acme Fresh | Odoo | Confirmed |
| Acme Stores | *(blank — "Not yet confirmed")* | Unconfirmed |

- [ ] Acme Stores genuinely shows unconfirmed on a fresh load — even though invoices from Acme Stores elsewhere in the app are tagged D365 for demo purposes, this table should **not** already show it as confirmed (that's the deliberate point being tested — nothing here is guessed)
- [ ] Setting Acme Stores to Dynamics 365 flips its badge to "Confirmed"
- [ ] Adding a new subsidiary name via the form at the bottom adds a new "Not yet confirmed" row

- [ ] Log out, log in as `auditor` → same two tables are visible, but every control is now read-only, with a note explaining why
- [ ] Log in as `reviewer` (or `approver`, or `vendor_admin`) → no "Admin" link in the nav at all; typing `/admin` directly into the URL bar bounces you back to the Dashboard instead of showing the screen

## 7. Reports screen

| Metric | Expected |
|---|---|
| Average time to a decision | **2.2 days** (across 4 resolved invoices) |
| Acme Fresh discrepancy rate | **50%** (3 of 6 compared invoices) |
| Acme Stores discrepancy rate | **50%** (2 of 4 compared invoices) |
| Resolution time — Acme Fresh | **1.2 days** avg (2 resolved) |
| Resolution time — Acme Stores | **3.2 days** avg (2 resolved) |
| Resend frequency | Adaeze Foods Ltd: **1**, Northgate Livestock Distributors Ltd: **1** |

By-vendor discrepancy rates, highest first: Yaba Packaging Nig. Ltd and
Highland Dairy Nigeria Ltd at **100%** (every invoice on file from them had
a mismatch — small sample, one invoice each), then Delta Meats Supply Co.
and Coastal Beverages Plc at **50%**, then three vendors at **0%**.

- [ ] All of the above matches
- [ ] This screen is reachable by every role (no Admin-style restriction here — that's intentional)

## 8. Logout and session

- [ ] Logging out returns you to `/login`
- [ ] While logged out, typing `/dashboard` (or any other screen) directly into the URL bar bounces you back to `/login` instead of showing the page

## Want to test with different data?

Everything above comes from `src/lib/mockData.js` (invoices),
`src/lib/adminData.js` (users, subsidiary mapping). They're plain
JavaScript arrays of objects — add, remove, or edit entries there and
restart `npm run dev` to test against different scenarios (a 13th vendor,
a bigger mismatch, a 6th user, etc.). No backend or database involved in
making that change.

## If something doesn't match

Tell me exactly:
1. Which numbered section and checkbox
2. What you expected (copy it from this guide)
3. What you actually saw

That's enough for me to find and fix it without needing you to describe
the whole flow again.
