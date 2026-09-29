import express from 'express';
import { requireAuth } from '../auth/middleware.js';
import { query } from '../db.js';

export const reportsRouter = express.Router();
reportsRouter.use(requireAuth);
// No role restriction, matching the reference contract — Reports has
// nothing a Reviewer/Approver shouldn't see, unlike Admin's user data.

// All four aggregates are computed in SQL, not by pulling every invoice into
// Node and reducing in JS (what reportsData.js does, fine for ~12 mock
// rows). At 10,000+ invoices/month that difference is the whole ballgame,
// and it relies on the indexes in db/migrations/001_init.sql.

reportsRouter.get('/summary', async (req, res, next) => {
  try {
    const [byVendor, bySubsidiary, resolution, resend] = await Promise.all([
      discrepancyRatesBy('v.name AS key'),
      discrepancyRatesBy('i.subsidiary AS key'),
      resolutionTime(),
      resendFrequency(),
    ]);

    res.json({
      discrepancyByVendor: byVendor.map(({ key, ...rest }) => ({ vendor: key, ...rest })),
      discrepancyBySubsidiary: bySubsidiary.map(({ key, ...rest }) => ({ subsidiary: key, ...rest })),
      resolutionTime: resolution,
      resendFrequency: resend,
    });
  } catch (err) { next(err); }
});

async function discrepancyRatesBy(keyExpr) {
  // "Compared" mirrors wasCompared() in reportsData.js: not blurry, and a
  // severity verdict actually exists.
  const { rows } = await query(`
    SELECT ${keyExpr},
           count(*)::int AS total,
           count(*) FILTER (WHERE i.severity = 'mismatch')::int AS mismatches
      FROM invoices i
      JOIN vendors v ON v.id = i.vendor_id
     WHERE i.status != 'blurry' AND i.severity IS NOT NULL
     GROUP BY key
     ORDER BY (count(*) FILTER (WHERE i.severity = 'mismatch'))::float / count(*) DESC
  `);
  return rows.map((r) => ({ key: r.key, total: r.total, mismatches: r.mismatches, rate: r.mismatches / r.total }));
}

async function resolutionTime() {
  // "Resolved" = the most recent approved/rejected activity_log entry for
  // that invoice; days = time from submission to that entry.
  const { rows } = await query(`
    WITH resolved AS (
      SELECT i.id, i.subsidiary, i.submitted_at,
             (SELECT a.created_at FROM activity_log a
               WHERE a.invoice_id = i.id AND a.type IN ('approved', 'rejected')
               ORDER BY a.created_at DESC LIMIT 1) AS resolved_at
        FROM invoices i
    )
    SELECT subsidiary,
           EXTRACT(EPOCH FROM (resolved_at - submitted_at)) / 86400.0 AS days
      FROM resolved
     WHERE resolved_at IS NOT NULL
  `);

  const overallDays = rows.length ? rows.reduce((s, r) => s + Number(r.days), 0) / rows.length : null;

  const bySubMap = new Map();
  for (const r of rows) {
    const list = bySubMap.get(r.subsidiary) || [];
    list.push(Number(r.days));
    bySubMap.set(r.subsidiary, list);
  }
  const bySubsidiary = [...bySubMap.entries()]
    .map(([subsidiary, days]) => ({ subsidiary, avgDays: days.reduce((a, b) => a + b, 0) / days.length, count: days.length }))
    .sort((a, b) => b.avgDays - a.avgDays);

  return { overallDays, count: rows.length, bySubsidiary };
}

async function resendFrequency() {
  // "Sender" is read as the invoice's vendor — same open note as
  // reportsData.js: revisit once the real intake channel exists.
  const { rows } = await query(`
    SELECT v.name AS vendor, count(*)::int AS count
      FROM invoices i JOIN vendors v ON v.id = i.vendor_id
     WHERE i.status = 'blurry'
     GROUP BY v.name
     ORDER BY count DESC
  `);
  return rows;
}
