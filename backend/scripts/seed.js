#!/usr/bin/env node
// Ports the exact 12 demo invoices + 5 users + subsidiary map from
// ap-recon-frontend/src/lib/mockData.js and adminData.js into real Postgres
// rows — so TESTING-GUIDE.md's checklist (written against those exact
// numbers) can be run against this real backend instead of the mock/
// reference-server, as the acceptance test for this whole build.
//
// The tax derivation below (subtotal * 7.5%) is copied from mockData.js
// ON PURPOSE, ONLY for reproducing this fixed demo dataset — it is NOT used
// anywhere in the real pipeline (integrations/llm/extract.js extracts the
// actual tax printed on each real invoice; see that file's header for why a
// flat rate is wrong for a Nigerian grocery retailer post the Jan 2026 VAT
// reform, which zero-rated many food items).
//
// Safe to run once against a fresh database. Run it twice and it will error
// on the duplicate seed users/invoices — drop and re-migrate first if you
// want a clean re-seed.

import 'dotenv/config';
import pg from 'pg';
import { hashPassword } from '../src/auth/hash.js';
import { runMatch } from '../src/invoices/matching.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function daysAgo(days, hour = 9, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function line(description, quantity, unit_price, product_code = null) {
  return { description, product_code, quantity, unit_price, line_total: Math.round(quantity * unit_price * 100) / 100 };
}

const DEMO_USERS = [
  { name: 'Dana R.', username: 'reviewer', role: 'reviewer' },
  { name: 'Jordan A.', username: 'approver', role: 'approver' },
  { name: 'Morgan F.', username: 'vendor_admin', role: 'vendor_tolerance_admin' },
  { name: 'Casey N.', username: 'auditor', role: 'auditor' },
  { name: 'IT Admin', username: 'admin', role: 'system_admin' },
];
const DEMO_PASSWORD = 'demo1234'; // matches adminData.js — demo credentials only, see that file's header

const SUBSIDIARY_MAP = [
  { subsidiary: 'Acme Fresh', erp: 'odoo', confirmed: true },
  { subsidiary: 'Acme Stores', erp: null, confirmed: false },
];

// Ported verbatim from mockData.js's RAW_INVOICES (now including poLines —
// see that file's comments for the story behind each scenario).
const RAW_INVOICES = [
  { id: 'inv_001', invoice_number: 'INV-2026-3381', vendor_name: 'Delta Meats Supply Co.', subsidiary: 'Acme Fresh', erp_source: 'odoo', po_number: 'PO-AF-2281', invoice_date_offset: 2, submitted_offset: 2, status: 'pending',
    extractedLines: [line('Beef carcass, grade A', 380, 4150, 'BF-CARC-A'), line('Chicken, whole dressed', 210, 2650, 'CHK-WD-01')],
    erpLines: [line('Beef carcass, grade A', 380, 4150, 'BF-CARC-A'), line('Chicken, whole dressed', 210, 2650, 'CHK-WD-01')],
    poLines: [line('Beef carcass, grade A', 380, 4150, 'BF-CARC-A'), line('Chicken, whole dressed', 210, 2650, 'CHK-WD-01')],
    confidence_notes: '' },
  { id: 'inv_002', invoice_number: 'INV-2026-3390', vendor_name: 'Northgate Livestock Distributors Ltd', subsidiary: 'Acme Fresh', erp_source: 'odoo', po_number: 'PO-AF-2299', invoice_date_offset: 4, submitted_offset: 4, status: 'pending',
    extractedLines: [line('Goat meat, bone-in', 150, 3900, 'GT-BI-02'), line('Packaging crates', 40, 2500, 'PKG-CR-40')],
    erpLines: [line('Goat meat, bone-in', 150, 3880, 'GT-BI-02'), line('Packaging crates', 40, 2500, 'PKG-CR-40')],
    // PO cut at a lower price than either the invoice or receipt — a
    // genuine PO-level mismatch the GRN comparison alone wouldn't catch.
    poLines: [line('Goat meat, bone-in', 150, 3750, 'GT-BI-02'), line('Packaging crates', 40, 2500, 'PKG-CR-40')],
    confidence_notes: '' },
  { id: 'inv_003', invoice_number: 'INV-2026-3352', vendor_name: 'Yaba Packaging Nig. Ltd', subsidiary: 'Acme Fresh', erp_source: 'odoo', po_number: null, invoice_date_offset: 13, submitted_offset: 13, status: 'pending',
    extractedLines: [line('Vacuum-seal packaging rolls', 60, 8200, 'VSP-ROLL'), line('Label rolls, thermal', 25, 3100, 'LBL-TH-25')],
    erpLines: [line('Vacuum-seal packaging rolls', 60, 7600, 'VSP-ROLL'), line('Label rolls, thermal', 25, 3100, 'LBL-TH-25')],
    confidence_notes: 'PO number not printed on this invoice — matched to Odoo bill by vendor name and date window instead.',
    activityExtra: [{ type: 'comment', author: 'Dana R.', role: 'reviewer', offset: 11, note: 'Vendor confirmed by phone this was a one-off price increase, not yet reflected in our PO. Flagging for approver.' }] },
  { id: 'inv_004', invoice_number: 'INV-2026-3398', vendor_name: 'Emeka & Sons Trading Co.', subsidiary: 'Acme Fresh', erp_source: 'odoo', po_number: 'PO-AF-2305', invoice_date_offset: 1, submitted_offset: 1, status: 'approved', resolvedOffset: 0, resolvedBy: 'Jordan A.',
    extractedLines: [line('Spice mix, house blend', 30, 5400, 'SPC-HB-30')],
    erpLines: [line('Spice mix, house blend', 30, 5400, 'SPC-HB-30')],
    poLines: [line('Spice mix, house blend', 30, 5400, 'SPC-HB-30')],
    confidence_notes: '' },
  { id: 'inv_005', invoice_number: 'INV-2026-3301', vendor_name: 'Delta Meats Supply Co.', subsidiary: 'Acme Fresh', erp_source: 'odoo', po_number: 'PO-AF-2266', invoice_date_offset: 6, submitted_offset: 6, status: 'rejected', resolvedOffset: 5, resolvedBy: 'Jordan A.',
    rejectReason: 'Duplicate submission', rejectNote: 'Already reconciled under INV-2026-3244 last week. Asked the store to confirm before resending.',
    extractedLines: [line('Beef carcass, grade A', 300, 4150, 'BF-CARC-A')],
    erpLines: [],
    // The PO itself is fine — this is a duplicate submission against an
    // already-reconciled receipt, not a PO-level discrepancy.
    poLines: [line('Beef carcass, grade A', 300, 4150, 'BF-CARC-A')],
    confidence_notes: '' },
  { id: 'inv_006', invoice_number: 'AS-INV-9021', vendor_name: 'Coastal Beverages Plc', subsidiary: 'Acme Stores', erp_source: 'd365', po_number: 'PO-AS-4410', invoice_date_offset: 3, submitted_offset: 3, status: 'pending',
    extractedLines: [line('Bottled water 60cl, carton', 200, 1850, 'BW-60-CTN'), line('Malt drink 33cl, carton', 150, 2400, 'MD-33-CTN')],
    erpLines: [line('Bottled water 60cl, carton', 200, 1850, 'BW-60-CTN'), line('Malt drink 33cl, carton', 150, 2400, 'MD-33-CTN')],
    poLines: [line('Bottled water 60cl, carton', 200, 1850, 'BW-60-CTN'), line('Malt drink 33cl, carton', 150, 2400, 'MD-33-CTN')],
    confidence_notes: '' },
  { id: 'inv_007', invoice_number: 'AS-INV-9034', vendor_name: 'Highland Dairy Nigeria Ltd', subsidiary: 'Acme Stores', erp_source: 'd365', po_number: 'PO-AS-4425', invoice_date_offset: 8, submitted_offset: 8, status: 'pending',
    extractedLines: [line('UHT milk 1L, carton', 500, 1650, 'UHT-1L-CTN')],
    erpLines: [line('UHT milk 1L, carton', 460, 1650, 'UHT-1L-CTN')],
    // PO was cut for the full 500 cartons and matches the invoice exactly —
    // the shortfall only shows up against the GRN (partial delivery).
    poLines: [line('UHT milk 1L, carton', 500, 1650, 'UHT-1L-CTN')],
    confidence_notes: '',
    activityExtra: [{ type: 'comment', author: 'Taylor B.', role: 'reviewer', offset: 6, note: 'Receipt shows a partial delivery — 40 cartons short. Checking with the warehouse before this goes further.' }] },
  { id: 'inv_008', invoice_number: 'AS-INV-9040', vendor_name: 'Ilesha Fresh Produce Ltd', subsidiary: 'Acme Stores', erp_source: 'd365', po_number: 'PO-AS-4432', invoice_date_offset: 5, submitted_offset: 5, status: 'approved', resolvedOffset: 1, resolvedBy: 'Riley K.',
    extractedLines: [line('Tomatoes, crate', 80, 3200, 'TOM-CRT-80')],
    erpLines: [line('Tomatoes, crate', 80, 3180, 'TOM-CRT-80')],
    poLines: [line('Tomatoes, crate', 80, 3200, 'TOM-CRT-80')],
    confidence_notes: '' },
  { id: 'inv_009', invoice_number: 'AS-INV-9052', vendor_name: 'Adaeze Foods Ltd', subsidiary: 'Acme Stores', erp_source: 'd365', po_number: null, invoice_date_offset: 5, submitted_offset: 5, status: 'blurry',
    extractedLines: [], erpLines: [], confidence_notes: '' },
  { id: 'inv_010', invoice_number: 'INV-2026-3405', vendor_name: 'Northgate Livestock Distributors Ltd', subsidiary: 'Acme Fresh', erp_source: 'odoo', po_number: null, invoice_date_offset: 2, submitted_offset: 2, status: 'blurry',
    extractedLines: [], erpLines: [], confidence_notes: '' },
  { id: 'inv_011', invoice_number: 'INV-2026-3298', vendor_name: 'Yaba Packaging Nig. Ltd', subsidiary: 'Acme Fresh', erp_source: 'odoo', po_number: 'PO-AF-2244', invoice_date_offset: 15, submitted_offset: 15, status: 'pending',
    extractedLines: [line('Cling film rolls', 100, 1900, 'CF-ROLL-1900')],
    erpLines: [line('Cling film rolls', 100, 1700, 'CF-ROLL-1900')],
    // PO agrees with the invoiced price — the receipt-side price looks
    // stale, which is exactly what this second comparison is meant to catch.
    poLines: [line('Cling film rolls', 100, 1900, 'CF-ROLL-1900')],
    confidence_notes: '' },
  { id: 'inv_012', invoice_number: 'AS-INV-8988', vendor_name: 'Coastal Beverages Plc', subsidiary: 'Acme Stores', erp_source: 'd365', po_number: null, invoice_date_offset: 9, submitted_offset: 9, status: 'rejected', resolvedOffset: 7, resolvedBy: 'Riley K.',
    rejectReason: 'Pricing discrepancy escalated to vendor', rejectNote: 'Both quantity and unit price are off from the receipt. Asked the vendor to resend a corrected invoice rather than approve with a large adjustment.',
    extractedLines: [line('Malt drink 33cl, carton', 180, 2600, 'MD-33-CTN')],
    erpLines: [line('Malt drink 33cl, carton', 150, 2400, 'MD-33-CTN')],
    confidence_notes: '' },
];

function sum(lines) {
  return Math.round(lines.reduce((t, l) => t + l.line_total, 0) * 100) / 100;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Seeding users...');
    const userIdByName = {};
    for (const u of DEMO_USERS) {
      const passwordHash = await hashPassword(DEMO_PASSWORD);
      const { rows } = await client.query(
        'INSERT INTO users (name, username, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
        [u.name, u.username, u.role, passwordHash]
      );
      userIdByName[u.name] = rows[0].id;
    }
    // Taylor B. and Riley K. appear only as activity authors in the demo data,
    // never as login accounts in DEMO_USERS — mirroring mockData.js exactly
    // (their comments are seeded as historical activity, not accounts you
    // can log in as). activity_log.author_user_id is nullable for exactly
    // this reason; see repository.js's logActivity.

    console.log('Seeding subsidiary/ERP map...');
    for (const row of SUBSIDIARY_MAP) {
      await client.query('INSERT INTO subsidiary_erp_map (subsidiary, erp, confirmed) VALUES ($1, $2, $3)', [row.subsidiary, row.erp, row.confirmed]);
    }

    console.log('Seeding vendors + invoices...');
    const vendorIdByName = {};
    const poIdByNumber = {};

    for (const raw of RAW_INVOICES) {
      if (!vendorIdByName[raw.vendor_name]) {
        const { rows } = await client.query('INSERT INTO vendors (name) VALUES ($1) RETURNING id', [raw.vendor_name]);
        vendorIdByName[raw.vendor_name] = rows[0].id;
      }
      const vendorId = vendorIdByName[raw.vendor_name];

      const extractedSubtotal = raw.extractedLines.length ? sum(raw.extractedLines) : null;
      const extractedTax = extractedSubtotal !== null ? Math.round(extractedSubtotal * 0.075 * 100) / 100 : null;
      const extractedTotal = extractedSubtotal !== null ? Math.round((extractedSubtotal + extractedTax) * 100) / 100 : null;

      const erpSubtotal = raw.erpLines.length ? sum(raw.erpLines) : null;
      const erpTax = erpSubtotal !== null ? Math.round(erpSubtotal * 0.075 * 100) / 100 : null;
      const erpTotal = erpSubtotal !== null ? Math.round((erpSubtotal + erpTax) * 100) / 100 : null;

      const hasPO = Boolean(raw.poLines && raw.poLines.length);
      const poSubtotal = hasPO ? sum(raw.poLines) : null;
      const poTax = poSubtotal !== null ? Math.round(poSubtotal * 0.075 * 100) / 100 : null;
      const poTotal = poSubtotal !== null ? Math.round((poSubtotal + poTax) * 100) / 100 : null;

      const numericId = Number(raw.id.split('_')[1]);
      const erpReference =
        raw.erpLines.length || raw.status === 'approved'
          ? raw.erp_source === 'odoo' ? `BILL/2026/${1000 + numericId}` : `PR-${88000 + numericId}`
          : null;
      const erpLabel = raw.erp_source === 'odoo' ? 'Odoo bill' : 'D365 Product Receipt';

      const isBlurry = raw.status === 'blurry';
      const match = isBlurry
        ? { severity: null, field_status: {}, lineComparison: [], discrepancies: [] }
        : runMatch(
            { subtotal: extractedSubtotal, tax_amount: extractedTax, total_amount: extractedTotal, line_items: raw.extractedLines },
            erpSubtotal !== null ? { subtotal: erpSubtotal, tax_amount: erpTax, total_amount: erpTotal, line_items: raw.erpLines } : null
          );

      // Invoice-vs-PO match — same engine, same tolerance, run against
      // purchase_order_lines instead of the GRN/bill. See mockData.js /
      // purchase-orders/repository.js for why this is a separate comparison.
      const poMatch = isBlurry || !hasPO
        ? { field_status: {}, lineComparison: [], discrepancies: [] }
        : runMatch(
            { subtotal: extractedSubtotal, tax_amount: extractedTax, total_amount: extractedTotal, line_items: raw.extractedLines },
            { subtotal: poSubtotal, tax_amount: poTax, total_amount: poTotal, line_items: raw.poLines },
            { otherLabel: 'po' }
          );

      const invoiceDate = daysAgo(raw.invoice_date_offset);
      const dueDate = daysAgo(raw.invoice_date_offset - 30);
      const submittedAt = daysAgo(raw.submitted_offset, 8, 5);

      let purchaseOrderId = null;
      let poLineIdByDescription = {};
      if (hasPO) {
        if (!poIdByNumber[raw.po_number]) {
          const { rows } = await client.query(
            `INSERT INTO purchase_orders (po_number, erp_source, vendor_name, subsidiary, currency, subtotal, tax_amount, total_amount)
             VALUES ($1,$2,$3,$4,'NGN',$5,$6,$7) RETURNING id`,
            [raw.po_number, raw.erp_source, raw.vendor_name, raw.subsidiary, poSubtotal, poTax, poTotal]
          );
          poIdByNumber[raw.po_number] = rows[0].id;
          for (const [idx, l] of raw.poLines.entries()) {
            const { rows: lineRows } = await client.query(
              `INSERT INTO purchase_order_lines (purchase_order_id, line_number, description, product_code, quantity, unit_price, line_total)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, description`,
              [rows[0].id, idx, l.description, l.product_code, l.quantity, l.unit_price, l.line_total]
            );
            poLineIdByDescription[lineRows[0].description] = lineRows[0].id;
          }
        } else {
          const { rows } = await client.query(
            'SELECT id, description FROM purchase_order_lines WHERE purchase_order_id = $1',
            [poIdByNumber[raw.po_number]]
          );
          for (const r of rows) poLineIdByDescription[r.description] = r.id;
        }
        purchaseOrderId = poIdByNumber[raw.po_number];
      }

      const { rows: invRows } = await client.query(
        `INSERT INTO invoices (invoice_number, vendor_id, subsidiary, erp_source, currency, invoice_date, due_date,
                                po_number, submitted_at, status, severity,
                                extracted_subtotal, extracted_tax_amount, extracted_total_amount, extraction_confidence_notes,
                                erp_record_label, erp_record_reference, erp_subtotal, erp_tax_amount, erp_total_amount,
                                field_status, discrepancies, purchase_order_id, po_field_status, po_discrepancies)
         VALUES ($1,$2,$3,$4,'NGN',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         RETURNING id`,
        [
          raw.invoice_number, vendorId, raw.subsidiary, raw.erp_source, invoiceDate, dueDate,
          raw.po_number, submittedAt, raw.status, match.severity,
          extractedSubtotal, extractedTax, extractedTotal, raw.confidence_notes || '',
          erpLabel, erpReference, erpSubtotal, erpTax, erpTotal,
          JSON.stringify(match.field_status), JSON.stringify(match.discrepancies),
          purchaseOrderId, JSON.stringify(poMatch.field_status), JSON.stringify(poMatch.discrepancies),
        ]
      );
      const invoiceId = invRows[0].id;

      const erpLineIdByDescription = {};
      for (const [idx, l] of raw.erpLines.entries()) {
        const { rows } = await client.query(
          `INSERT INTO invoice_line_items (invoice_id, source, line_number, description, product_code, quantity, unit_price, line_total)
           VALUES ($1,'erp',$2,$3,$4,$5,$6,$7) RETURNING id`,
          [invoiceId, idx, l.description, l.product_code, l.quantity, l.unit_price, l.line_total]
        );
        erpLineIdByDescription[l.description] = rows[0].id;
      }
      const extractedLineIdByDescription = {};
      for (const [idx, l] of raw.extractedLines.entries()) {
        const comparison = match.lineComparison[idx];
        const { rows } = await client.query(
          `INSERT INTO invoice_line_items (invoice_id, source, line_number, description, product_code, quantity, unit_price, line_total,
                                            matched_line_id, qty_status, price_status, line_status)
           VALUES ($1,'extracted',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [
            invoiceId, idx, l.description, l.product_code, l.quantity, l.unit_price, l.line_total,
            comparison?.erp ? erpLineIdByDescription[comparison.erp.description] || null : null,
            comparison?.qty_status || null, comparison?.price_status || null, comparison?.status || null,
          ]
        );
        extractedLineIdByDescription[l.description] = rows[0].id;
      }

      if (hasPO) {
        for (const [idx, l] of raw.extractedLines.entries()) {
          const poComparison = poMatch.lineComparison[idx];
          await client.query(
            `INSERT INTO invoice_po_line_matches (invoice_id, invoice_line_item_id, purchase_order_line_id, qty_status, price_status, line_status)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              invoiceId, extractedLineIdByDescription[l.description],
              poComparison?.erp ? poLineIdByDescription[poComparison.erp.description] || null : null,
              poComparison?.qty_status || null, poComparison?.price_status || null, poComparison?.status || null,
            ]
          );
        }
      }

      const intakeNote = isBlurry
        ? 'Invoice received. Flagged unreadable before extraction — resend requested from sender automatically.'
        : 'Invoice received and queued for extraction.';
      await client.query(
        `INSERT INTO activity_log (invoice_id, type, author_user_id, author_name, author_role, note, created_at)
         VALUES ($1,'system',NULL,'System','system',$2,$3)`,
        [invoiceId, intakeNote, submittedAt]
      );

      for (const extra of raw.activityExtra || []) {
        await client.query(
          `INSERT INTO activity_log (invoice_id, type, author_user_id, author_name, author_role, note, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [invoiceId, extra.type, userIdByName[extra.author] || null, extra.author, extra.role, extra.note, daysAgo(extra.offset)]
        );
      }

      if (raw.status === 'approved') {
        await client.query(
          `INSERT INTO activity_log (invoice_id, type, author_user_id, author_name, author_role, note, created_at)
           VALUES ($1,'approved',$2,$3,'approver','Approved. No mismatch outside tolerance.',$4)`,
          [invoiceId, userIdByName[raw.resolvedBy] || null, raw.resolvedBy, daysAgo(raw.resolvedOffset, 14, 20)]
        );
      } else if (raw.status === 'rejected') {
        await client.query(
          `INSERT INTO activity_log (invoice_id, type, author_user_id, author_name, author_role, note, created_at)
           VALUES ($1,'rejected',$2,$3,'approver',$4,$5)`,
          [invoiceId, userIdByName[raw.resolvedBy] || null, raw.resolvedBy, `${raw.rejectReason}. ${raw.rejectNote || ''}`.trim(), daysAgo(raw.resolvedOffset, 11, 40)]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Seeded ${DEMO_USERS.length} users and ${RAW_INVOICES.length} invoices.`);
    console.log(`Log in as any of: ${DEMO_USERS.map((u) => u.username).join(', ')} — password "${DEMO_PASSWORD}" for all.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
