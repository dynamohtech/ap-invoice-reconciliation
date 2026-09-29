// Standalone Purchase Order records — see
// db/migrations/004_add_purchase_orders.sql for the schema and full
// reasoning. This module is the PO-side counterpart to what
// invoices/repository.js already does for the GRN/bill comparison: fetch
// once from the real ERP, persist, and run the same matching engine
// (matching.js's runMatch — completely unchanged, reused as-is) to produce
// a field_status / lineComparison / discrepancies shape the frontend
// already knows how to render.
//
// Three entry points, called from invoices/repository.js at the same two
// points the existing GRN comparison is built:
//   1. getOrFetchPurchaseOrder  — at invoice creation (createInvoiceFromPOLookup),
//      right after the GRN/bill lookup. Best-effort: if neither ERP has a
//      standalone PO under this number (or credentials for that ERP aren't
//      configured yet), the invoice is still created — this comparison
//      just stays unavailable, same as any other optional enrichment.
//   2. computeAndStorePOMatch    — at extraction-complete (saveExtraction),
//      once the extracted line items actually exist to compare against.
//   3. getPOComparisonForInvoice — at read time (getInvoiceById), joins the
//      stored PO + its lines + the stored per-line match into the exact
//      shape ap-recon-frontend's mockData.js produces (poRecord /
//      poFieldStatus / poLineComparison / poDiscrepancies).

import { pool } from '../db.js';
import { runMatch } from '../invoices/matching.js';
import { fetchPurchaseOrder as fetchD365PO } from '../integrations/d365/client.js';
import { fetchPurchaseOrder as fetchOdooPO } from '../integrations/odoo/client.js';

function numOrNull(v) {
  return v === null || v === undefined ? null : Number(v);
}

// How long a cached PO is trusted before the next invoice referencing it
// triggers a refetch. POs don't move hour-to-hour in practice, so this
// defaults conservatively high rather than hammering the ERP on every
// upload — tune via env if the company's procurement process amends POs more
// often than that. This does NOT retroactively change any already-matched
// invoice's verdict (see runMatchAndPersist below) — it only decides
// whether the *next* invoice to reference this PO gets a fresh fetch or
// the cached copy.
const REFRESH_TTL_MS = (Number(process.env.PO_REFRESH_TTL_HOURS) || 24) * 60 * 60 * 1000;

async function fetchFromErp(poNumber, erpSourceHint) {
  const fetchers = erpSourceHint === 'odoo' ? [fetchOdooPO, fetchD365PO] : [fetchD365PO, fetchOdooPO];
  for (const fetcher of fetchers) {
    try {
      const poData = await fetcher(poNumber);
      if (poData) return poData;
    } catch (err) {
      // Credentials not configured, or the ERP unreachable — this is best-
      // effort enrichment, never fatal to invoice creation. See file header.
      console.warn(`[purchase-orders] ${fetcher.name} failed for PO ${poNumber}: ${err.message}`);
    }
  }
  return null;
}

async function readCached(client, purchaseOrderId) {
  const lines = await client.query(
    'SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY line_number',
    [purchaseOrderId]
  );
  return lines.rows;
}

/** Upserts the header (by po_number) and lines (by purchase_order_id + line_number)
 * in place — never a blind delete-and-reinsert, so a line whose content is
 * unchanged between refreshes keeps the same id, and only line_numbers that
 * genuinely disappeared from the ERP's answer get removed (safe to do now —
 * see migrations/005_po_refresh_fk.sql for why that's no longer blocked by
 * historical invoice_po_line_matches references). */
async function upsertPurchaseOrder(client, poData) {
  const { rows: headerRows } = await client.query(
    `INSERT INTO purchase_orders (po_number, erp_source, vendor_name, subsidiary, currency, order_date, subtotal, tax_amount, total_amount, raw_response, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (po_number) DO UPDATE SET
       erp_source = EXCLUDED.erp_source, vendor_name = EXCLUDED.vendor_name, subsidiary = EXCLUDED.subsidiary,
       currency = EXCLUDED.currency, order_date = EXCLUDED.order_date, subtotal = EXCLUDED.subtotal,
       tax_amount = EXCLUDED.tax_amount, total_amount = EXCLUDED.total_amount, raw_response = EXCLUDED.raw_response,
       fetched_at = now()
     RETURNING *`,
    [
      poData.po_number, poData.erp_source, poData.vendor_name, poData.subsidiary,
      poData.currency || 'NGN', poData.order_date || null,
      poData.subtotal, poData.tax_amount, poData.total_amount,
      JSON.stringify(poData.raw || null),
    ]
  );
  const header = headerRows[0];

  const seenLineNumbers = [];
  const lineRows = [];
  for (const [idx, l] of poData.line_items.entries()) {
    const lineNumber = l.line_number ?? idx;
    seenLineNumbers.push(lineNumber);
    const { rows } = await client.query(
      `INSERT INTO purchase_order_lines (purchase_order_id, line_number, description, product_code, quantity, unit_price, line_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (purchase_order_id, line_number) DO UPDATE SET
         description = EXCLUDED.description, product_code = EXCLUDED.product_code,
         quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price, line_total = EXCLUDED.line_total
       RETURNING *`,
      [header.id, lineNumber, l.description, l.product_code || null, l.quantity, l.unit_price, l.line_total]
    );
    lineRows.push(rows[0]);
  }
  // A line_number present before but absent from this fetch means the ERP
  // genuinely removed it (a real PO amendment) — drop it. Any invoice
  // already matched against it keeps its verdict (po_field_status /
  // po_discrepancies / qty_status / price_status / line_status are already
  // persisted, immutable JSON/enum columns); it just loses the live FK
  // pointer, which migrations/005 made safe.
  if (seenLineNumbers.length) {
    await client.query(
      `DELETE FROM purchase_order_lines WHERE purchase_order_id = $1 AND line_number <> ALL($2::int[])`,
      [header.id, seenLineNumbers]
    );
  }

  return { header, lines: lineRows };
}

/**
 * Returns the persisted purchase_orders row (with its lines) for a PO
 * number — fetching fresh from the real ERP and upserting in place when
 * there's no cached copy yet, or the cached copy is older than
 * PO_REFRESH_TTL_HOURS. `erpSourceHint` (from the invoice's own GRN lookup
 * — we already know which ERP answered) is tried first, purely to avoid a
 * wasted round trip; both are tried regardless before giving up, since a PO
 * and its receipt/bill aren't guaranteed to live in the same system.
 *
 * A refetch here changes what the *next* comparison sees — it never
 * rewrites an already-computed invoice's verdict. That only happens via an
 * explicit re-match: normally once, at extraction time (saveExtraction),
 * or on demand via refreshPurchaseOrderForInvoice below.
 *
 * Must be called with the transaction's `client` (see findOrCreateVendor in
 * invoices/repository.js for why). Returns null (never throws) if the PO
 * genuinely isn't found in either ERP and there's no usable cached copy —
 * a normal, non-fatal outcome, not treated as an error the way "PO not
 * found at all" is during upload (that already failed loudly earlier, via
 * lookupPOForUpload).
 */
export async function getOrFetchPurchaseOrder(client, poNumber, erpSourceHint, { force = false } = {}) {
  if (!poNumber) return null;

  const existing = await client.query('SELECT * FROM purchase_orders WHERE po_number = $1', [poNumber]);
  const cached = existing.rows[0];
  const isStale = !cached || Date.now() - new Date(cached.fetched_at).getTime() > REFRESH_TTL_MS;

  if (cached && !isStale && !force) {
    return { header: cached, lines: await readCached(client, cached.id) };
  }

  const poData = await fetchFromErp(poNumber, cached?.erp_source || erpSourceHint);
  if (!poData) {
    // ERP unreachable/not found on this attempt — if we have ANY cached
    // copy (even a stale one), that's still more useful than nothing.
    // Only a genuinely first-ever lookup with no fallback returns null.
    return cached ? { header: cached, lines: await readCached(client, cached.id) } : null;
  }

  return upsertPurchaseOrder(client, poData);
}

/**
 * Computes the invoice-vs-PO match (same runMatch() used for the GRN
 * comparison) and persists it: po_field_status / po_discrepancies on the
 * invoice row, plus one invoice_po_line_matches row per extracted line.
 * Called from saveExtraction, right after the equivalent GRN match — a
 * no-op (clears any previous result) if this invoice has no linked PO.
 *
 * `extracted` is the same { subtotal, tax_amount, total_amount, line_items }
 * shape saveExtraction already builds for the GRN match.
 * `extractedLineIds` maps line description -> invoice_line_items.id for the
 * just-(re)inserted 'extracted' rows, so match results can reference them.
 */
export async function computeAndStorePOMatch(client, invoiceId, extracted, extractedLineIdByDescription, tolerance) {
  const { rows: invRows } = await client.query('SELECT purchase_order_id FROM invoices WHERE id = $1', [invoiceId]);
  const purchaseOrderId = invRows[0]?.purchase_order_id;

  await client.query('DELETE FROM invoice_po_line_matches WHERE invoice_id = $1', [invoiceId]);

  if (!purchaseOrderId) {
    await client.query('UPDATE invoices SET po_field_status = $1, po_discrepancies = $2 WHERE id = $3', ['{}', '[]', invoiceId]);
    return;
  }

  const { rows: poHeaderRows } = await client.query('SELECT * FROM purchase_orders WHERE id = $1', [purchaseOrderId]);
  const { rows: poLineRows } = await client.query(
    'SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY line_number',
    [purchaseOrderId]
  );
  const poHeader = poHeaderRows[0];

  const poForMatch = {
    subtotal: numOrNull(poHeader.subtotal),
    tax_amount: numOrNull(poHeader.tax_amount),
    total_amount: numOrNull(poHeader.total_amount),
    line_items: poLineRows.map((l) => ({
      description: l.description,
      product_code: l.product_code,
      quantity: numOrNull(l.quantity),
      unit_price: numOrNull(l.unit_price),
      line_total: numOrNull(l.line_total),
    })),
  };

  const match = runMatch(extracted, poForMatch, { tolerance, otherLabel: 'po' });

  await client.query(
    'UPDATE invoices SET po_field_status = $1, po_discrepancies = $2 WHERE id = $3',
    [JSON.stringify(match.field_status), JSON.stringify(match.discrepancies), invoiceId]
  );

  const poLineIdByDescription = {};
  for (const l of poLineRows) poLineIdByDescription[l.description] = l.id;

  for (const [idx, l] of extracted.line_items.entries()) {
    const invoiceLineItemId = extractedLineIdByDescription[l.description];
    if (!invoiceLineItemId) continue; // shouldn't happen — every extracted line was just inserted by the caller
    const comparison = match.lineComparison[idx];
    await client.query(
      `INSERT INTO invoice_po_line_matches (invoice_id, invoice_line_item_id, purchase_order_line_id, qty_status, price_status, line_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (invoice_id, invoice_line_item_id) DO UPDATE SET
         purchase_order_line_id = EXCLUDED.purchase_order_line_id,
         qty_status = EXCLUDED.qty_status,
         price_status = EXCLUDED.price_status,
         line_status = EXCLUDED.line_status`,
      [
        invoiceId, invoiceLineItemId,
        comparison?.erp ? poLineIdByDescription[comparison.erp.description] || null : null,
        comparison?.qty_status || null, comparison?.price_status || null, comparison?.status || null,
      ]
    );
  }
}

/**
 * Read-side: builds { poRecord, poLineComparison } for one invoice, in the
 * exact shape ap-recon-frontend/src/lib/mockData.js's poRecord /
 * poLineComparison already use. poFieldStatus / poDiscrepancies are NOT
 * built here — they're plain columns on the invoice header row already
 * (po_field_status / po_discrepancies), read directly by the caller
 * (invoices/repository.js's serializeInvoice), same as fieldStatus /
 * discrepancies are for the GRN comparison.
 *
 * `extractedLines` is the invoice's own 'extracted' invoice_line_items rows
 * — already fetched by the caller for the GRN comparison, passed in here
 * rather than re-queried.
 */
export async function getPOComparisonForInvoice(header, extractedLines) {
  if (!header.purchase_order_id) return { poRecord: null, poLineComparison: [] };

  const [poHeaderRes, poLineRes, matchRes] = await Promise.all([
    pool.query('SELECT * FROM purchase_orders WHERE id = $1', [header.purchase_order_id]),
    pool.query('SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY line_number', [header.purchase_order_id]),
    pool.query('SELECT * FROM invoice_po_line_matches WHERE invoice_id = $1', [header.id]),
  ]);
  const poHeader = poHeaderRes.rows[0];
  if (!poHeader) return { poRecord: null, poLineComparison: [] };

  const poLinesById = Object.fromEntries(poLineRes.rows.map((l) => [l.id, l]));
  const matchByLineItemId = Object.fromEntries(matchRes.rows.map((m) => [m.invoice_line_item_id, m]));

  const poLineComparison = extractedLines.map((l) => {
    const m = matchByLineItemId[l.id];
    const poLine = m?.purchase_order_line_id ? poLinesById[m.purchase_order_line_id] : null;
    return {
      description: l.description,
      product_code: l.product_code,
      invoice: {
        description: l.description,
        product_code: l.product_code,
        quantity: numOrNull(l.quantity),
        unit_price: numOrNull(l.unit_price),
        line_total: numOrNull(l.line_total),
      },
      erp: poLine
        ? {
            description: poLine.description,
            product_code: poLine.product_code,
            quantity: numOrNull(poLine.quantity),
            unit_price: numOrNull(poLine.unit_price),
            line_total: numOrNull(poLine.line_total),
          }
        : null,
      status: m?.line_status || null,
      qtyStatus: m?.qty_status || null,
      priceStatus: m?.price_status || null,
    };
  });

  return {
    poRecord: {
      label: 'Purchase Order',
      reference: poHeader.po_number,
      subtotal: numOrNull(poHeader.subtotal),
      tax_amount: numOrNull(poHeader.tax_amount),
      total_amount: numOrNull(poHeader.total_amount),
      line_items: poLineRes.rows.map((l) => ({
        description: l.description,
        product_code: l.product_code,
        quantity: numOrNull(l.quantity),
        unit_price: numOrNull(l.unit_price),
        line_total: numOrNull(l.line_total),
      })),
    },
    poLineComparison,
  };
}
