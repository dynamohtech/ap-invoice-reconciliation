#!/usr/bin/env node
// Runs the same checks used to verify this backend while it was being
// built — turned into a script so anyone (technical or not) can confirm the
// whole stack actually works with one command:
//
//   npm run smoke-test
//
// Requires: the server running (docker compose up, or npm start) and
// seeded (npm run seed) first. Exits non-zero and prints which check failed
// if anything is wrong.

const BASE = process.env.SMOKE_TEST_BASE_URL || 'http://localhost:3001';
let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  OK   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

async function main() {
  console.log(`Running smoke test against ${BASE} ...\n`);

  console.log('Health check');
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  check('server responds and reports DB connected', health.status === 'ok' && health.db === 'connected');

  console.log('\nAuth');
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'reviewer', password: 'demo1234' }),
  });
  const login = await loginRes.json();
  check('login with seeded demo user succeeds', loginRes.status === 200 && Boolean(login.token));
  const token = login.token;
  const authHeader = { Authorization: `Bearer ${token}` };

  const badLoginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'reviewer', password: 'wrong' }),
  });
  check('wrong password is rejected with 401', badLoginRes.status === 401);

  console.log('\nDashboard + seeded data shape');
  const stats = await fetch(`${BASE}/api/dashboard/stats`, { headers: authHeader }).then((r) => r.json());
  check('12 seeded invoices present', stats.total === 12);
  check('6 pending, 2 rejected, 2 blurry (matches TESTING-GUIDE.md)', stats.pending === 6 && stats.rejected === 2 && stats.blurry === 2);

  console.log('\nSearch (the new capability this build adds)');
  const byPo = await fetch(`${BASE}/api/invoices?po_number=PO-AS-4410`, { headers: authHeader }).then((r) => r.json());
  check('search by PO number finds the right invoice', byPo.length === 1 && byPo[0].invoice_number === 'AS-INV-9021');
  const byInvNum = await fetch(`${BASE}/api/invoices?invoice_number=3390`, { headers: authHeader }).then((r) => r.json());
  check('search by invoice number (partial) finds the right invoice', byInvNum.length === 1 && byInvNum[0].po_number === 'PO-AF-2299');

  console.log('\nMatching engine fidelity (spot-checks against known scenarios)');
  const tolerance = await fetch(`${BASE}/api/invoices?invoice_number=INV-2026-3390`, { headers: authHeader }).then((r) => r.json());
  check('a ~0.5% price difference is classified "tolerance", not "mismatch"', tolerance[0]?.severity === 'tolerance');
  const mismatch = await fetch(`${BASE}/api/invoices?invoice_number=AS-INV-9034`, { headers: authHeader }).then((r) => r.json());
  check('an 8%+ quantity difference is classified "mismatch"', mismatch[0]?.severity === 'mismatch');

  console.log('\nStandalone PO comparison (new: purchase_orders / purchase_order_lines)');
  check('PO record is linked and labeled correctly', tolerance[0]?.poRecord?.reference === 'PO-AF-2299');
  check(
    'PO was cut at a lower price than the invoice — flagged even though the GRN-side price is within tolerance',
    tolerance[0]?.poDiscrepancies?.some((d) => /price mismatch/i.test(d))
  );
  const goatLine = tolerance[0]?.poLineComparison?.find((l) => l.description === 'Goat meat, bone-in');
  check('the specific PO line price mismatch is captured at line level', goatLine?.priceStatus === 'mismatch');
  check(
    'inverse case: PO matches the invoice exactly even though the GRN shows a partial-delivery mismatch',
    mismatch[0]?.poRecord && mismatch[0]?.poDiscrepancies?.length === 0
  );

  console.log('\nRBAC enforcement');
  const auditorLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'auditor', password: 'demo1234' }),
  }).then((r) => r.json());
  const auditorHeader = { Authorization: `Bearer ${auditorLogin.token}` };
  const approveAsAuditor = await fetch(`${BASE}/api/invoices/${mismatch[0].id}/approve`, {
    method: 'POST',
    headers: { ...auditorHeader, 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('auditor cannot approve an invoice (403)', approveAsAuditor.status === 403);
  const adminUsersAsAuditor = await fetch(`${BASE}/api/admin/users`, { headers: auditorHeader });
  check('auditor CAN read the admin user list (200)', adminUsersAsAuditor.status === 200);

  console.log('\nUpload validation');
  const missingPo = await fetch(`${BASE}/api/invoices/upload`, { method: 'POST', headers: authHeader });
  check('upload without po_number is rejected with 400', missingPo.status === 400);

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED — see above.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
