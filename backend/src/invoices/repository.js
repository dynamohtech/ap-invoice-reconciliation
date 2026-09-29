import { pool, query, withTransaction } from '../db.js';
import { runMatch, sum } from './matching.js';
import { getOrFetchPurchaseOrder, computeAndStorePOMatch, getPOComparisonForInvoice } from '../purchase-orders/repository.js';

// ---------------------------------------------------------------------------
// Serialization: DB rows -> the exact JSON shape ap-recon-frontend expects.
// This is the one place that translation happens. Two deliberate naming
// mismatches versus the (snake_case) DB columns, both confirmed against
// src/lib/mockData.js and preserved on purpose so the frontend needs zero
// changes:
//   - lineComparison entries use camelCase `qtyStatus` / `priceStatus`
//     (DB columns are qty_status / price_status)
//   - activity entries use `author` / `role` / `timestamp`
//     (DB columns are author_name / author_role / created_at)
// ---------------------------------------------------------------------------

function serializeInvoice(header, lineItems, activity, poData) {
  const extractedLines = lineItems.filter((l) => l.source === 'extracted');
  const erpLines = lineItems.filter((l) => l.source === 'erp');

  const lineComparison = extractedLines.map((l) => {
    const erpLine = l.matched_line_id ? erpLines.find((e) => e.id === l.matched_line_id) : null;
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
      erp: erpLine
        ? {
            description: erpLine.description,
            product_code: erpLine.product_code,
            quantity: numOrNull(erpLine.quantity),
            unit_price: numOrNull(erpLine.unit_price),
            line_total: numOrNull(erpLine.line_total),
          }
        : null,
      status: l.line_status,
      qtyStatus: l.qty_status,
      priceStatus: l.price_status,
    };
  });

  return {
    id: header.id,
    invoice_number: header.invoice_number,
    vendor_name: header.vendor_name,
    subsidiary: header.subsidiary,
    erp_source: header.erp_source,
    currency: header.currency,
    invoice_date: dateOnly(header.invoice_date),
    due_date: dateOnly(header.due_date),
    po_number: header.po_number,
    receipt_reference: header.receipt_reference,
    store_location: header.store_location,
    submitted_at: header.submitted_at,
    status: header.status,
    severity: header.severity,
    extracted: {
      subtotal: numOrNull(header.extracted_subtotal),
      tax_amount: numOrNull(header.extracted_tax_amount),
      total_amount: numOrNull(header.extracted_total_amount),
      line_items: extractedLines.map(stripLineForClient),
      confidence_notes: header.extraction_confidence_notes || '',
    },
    erpRecord: {
      label: header.erp_record_label,
      reference: header.erp_record_reference,
      subtotal: numOrNull(header.erp_subtotal),
      tax_amount: numOrNull(header.erp_tax_amount),
      total_amount: numOrNull(header.erp_total_amount),
      line_items: erpLines.map(stripLineForClient),
    },
    fieldStatus: header.field_status || {},
    lineComparison,
    discrepancies: header.discrepancies || [],
    // Invoice-vs-Purchase-Order comparison — separate from the GRN/bill
    // comparison above. poRecord is null (and poLineComparison empty) when
    // this invoice has no PO linked yet (no po_number on the invoice, or
    // neither ERP had a standalone PO under that number — see
    // purchase-orders/repository.js). poFieldStatus/poDiscrepancies are
    // plain JSONB columns, same pattern as fieldStatus/discrepancies above.
    poRecord: poData.poRecord,
    poFieldStatus: header.po_field_status || {},
    poLineComparison: poData.poLineComparison,
    poDiscrepancies: header.po_discrepancies || [],
    // Computed, not stored: a URL would break the moment the storage backend
    // changes (see src/upload/storage.js). The frontend just needs something
    // to point an <img>/<iframe> at; GET /api/invoices/:id/file serves it.
    image_url: header.file_storage_key ? `/api/invoices/${header.id}/file` : null,
    image_type: header.file_mime_type || null,
    activity: activity.map((a) => ({
      id: a.id,
      type: a.type,
      author: a.author_name,
      role: a.author_role,
      timestamp: a.created_at,
      note: a.note,
    })),
  };
}

function stripLineForClient(l) {
  return {
    description: l.description,
    product_code: l.product_code,
    quantity: numOrNull(l.quantity),
    unit_price: numOrNull(l.unit_price),
    line_total: numOrNull(l.line_total),
  };
}

function numOrNull(v) {
  return v === null || v === undefined ? null : Number(v);
}

function dateOnly(v) {
  if (!v) return null;
  // pg returns DATE columns as JS Date objects at UTC midnight; the frontend
  // wants a plain YYYY-MM-DD string (see mockData.js's daysAgo().slice(0,10)).
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Vendors — find-or-create by name, since the frontend/LLM extraction only
// ever deals in vendor_name strings, never vendor IDs.
// ---------------------------------------------------------------------------

export async function findOrCreateVendor(client, name) {
  const existing = await client.query('SELECT id, default_tolerance_pct FROM vendors WHERE name = $1', [name]);
  if (existing.rows[0]) return existing.rows[0];
  const created = await client.query(
    'INSERT INTO vendors (name) VALUES ($1) RETURNING id, default_tolerance_pct',
    [name]
  );
  return created.rows[0];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const LIST_BASE = `
  SELECT i.*, v.name AS vendor_name
    FROM invoices i
    JOIN vendors v ON v.id = i.vendor_id
`;

/**
 * filters: { subsidiary, erp_source, severity, status, vendor, invoice_number,
 *            po_number, page, page_size }
 *
 * page / page_size are optional. When omitted, every matching row is
 * returned (sorted oldest-submitted-first) — this matches the current
 * frontend contract and its TESTING-GUIDE.md checklist exactly. Revisit
 * that default before running at higher volume.
 */
export async function listInvoices(filters = {}) {
  const clauses = [];
  const params = [];
  let i = 1;

  if (filters.subsidiary) { clauses.push(`i.subsidiary = $${i++}`); params.push(filters.subsidiary); }
  if (filters.erp_source) { clauses.push(`i.erp_source = $${i++}`); params.push(filters.erp_source); }
  if (filters.severity) { clauses.push(`i.severity = $${i++}`); params.push(filters.severity); }
  if (filters.status) { clauses.push(`i.status = $${i++}`); params.push(filters.status); }
  if (filters.vendor) { clauses.push(`v.name ILIKE $${i++}`); params.push(`%${filters.vendor}%`); }
  // Search by invoice number or PO number.
  // Exact-or-prefix match via the plain B-tree index; falls back to a
  // substring (ILIKE) match using the pg_trgm index for partial numbers.
  if (filters.invoice_number) { clauses.push(`i.invoice_number ILIKE $${i++}`); params.push(`%${filters.invoice_number}%`); }
  if (filters.po_number) { clauses.push(`i.po_number ILIKE $${i++}`); params.push(`%${filters.po_number}%`); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  let sql = `${LIST_BASE} ${where} ORDER BY i.submitted_at ASC`;

  if (filters.page || filters.page_size) {
    const pageSize = Math.min(Number(filters.page_size) || 50, 200);
    const page = Math.max(Number(filters.page) || 1, 1);
    sql += ` LIMIT $${i++} OFFSET $${i++}`;
    params.push(pageSize, (page - 1) * pageSize);
  }

  const { rows } = await query(sql, params);
  const invoices = await Promise.all(rows.map((h) => attachChildren(h)));
  return invoices;
}

export async function getInvoiceById(id) {
  const { rows } = await query(`${LIST_BASE} WHERE i.id = $1`, [id]);
  if (!rows[0]) return null;
  return attachChildren(rows[0]);
}

async function attachChildren(header) {
  const [lineItemsRes, activityRes] = await Promise.all([
    query('SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY source, line_number', [header.id]),
    query('SELECT * FROM activity_log WHERE invoice_id = $1 ORDER BY created_at ASC', [header.id]),
  ]);
  const extractedLines = lineItemsRes.rows.filter((l) => l.source === 'extracted');
  const poData = await getPOComparisonForInvoice(header, extractedLines);
  return serializeInvoice(header, lineItemsRes.rows, activityRes.rows, poData);
}

export async function getFilterOptions() {
  const { rows } = await query('SELECT DISTINCT subsidiary FROM invoices ORDER BY subsidiary');
  return { subsidiaries: rows.map((r) => r.subsidiary) };
}

export async function computeStats() {
  const { rows: statusRows } = await query('SELECT status, count(*)::int AS n FROM invoices GROUP BY status');
  const { rows: subRows } = await query('SELECT subsidiary, count(*)::int AS n FROM invoices GROUP BY subsidiary');
  const { rows: erpRows } = await query('SELECT erp_source, count(*)::int AS n FROM invoices GROUP BY erp_source');
  const { rows: approvedTodayRows } = await query(`
    SELECT count(*)::int AS n FROM activity_log
     WHERE type = 'approved' AND created_at >= date_trunc('day', now())
  `);

  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.n]));
  return {
    pending: byStatus.pending || 0,
    approvedToday: approvedTodayRows[0]?.n || 0,
    rejected: byStatus.rejected || 0,
    blurry: byStatus.blurry || 0,
    total: statusRows.reduce((t, r) => t + r.n, 0),
    bySubsidiary: Object.fromEntries(subRows.map((r) => [r.subsidiary, r.n])),
    byErp: Object.fromEntries(erpRows.map((r) => [r.erp_source, r.n])),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function logActivity(client, invoiceId, type, note, actor) {
  await client.query(
    `INSERT INTO activity_log (invoice_id, type, author_user_id, author_name, author_role, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [invoiceId, type, actor?.id || null, actor?.name || 'System', actor?.role || 'system', note]
  );
}

// IMPORTANT on the shape below, repeated across every write function in this
// file: withTransaction's callback returns a plain found/not-found signal —
// it must NEVER call getInvoiceById (or any read through the shared pool)
// from inside itself. getInvoiceById opens its OWN connection via query()
// in db.js, separate from the transaction's `client` — and a transaction's
// writes aren't visible to any other connection until COMMIT runs, which
// withTransaction only does AFTER the callback returns. Reading through
// getInvoiceById from inside the callback silently returns pre-transaction
// data (this shipped once, was caught by hand-testing the approve endpoint
// against a real Postgres and seeing the response still show the OLD
// status). The fix is
// always the same: resolve the transaction with just an id/boolean, then
// call getInvoiceById AFTER it, once the commit has actually happened.

export async function approveInvoice(id, { comment, actor }) {
  const found = await withTransaction(async (client) => {
    const { rows } = await client.query("UPDATE invoices SET status = 'approved' WHERE id = $1 RETURNING id", [id]);
    if (!rows[0]) return false;
    await logActivity(client, id, 'approved', comment || 'Approved — no mismatch outside tolerance.', actor);
    return true;
  });
  return found ? getInvoiceById(id) : null;
}

export async function rejectInvoice(id, { reason, comment, actor }) {
  if (!reason) throw Object.assign(new Error('A rejection reason is required.'), { status: 400 });
  const found = await withTransaction(async (client) => {
    const { rows } = await client.query("UPDATE invoices SET status = 'rejected' WHERE id = $1 RETURNING id", [id]);
    if (!rows[0]) return false;
    await logActivity(client, id, 'rejected', `${reason}${comment ? '. ' + comment : ''}`, actor);
    return true;
  });
  return found ? getInvoiceById(id) : null;
}

export async function requestInfo(id, { comment, actor }) {
  const found = await withTransaction(async (client) => {
    const exists = await client.query('SELECT id FROM invoices WHERE id = $1', [id]);
    if (!exists.rows[0]) return false;
    await logActivity(client, id, 'requested_info', comment || 'More information requested.', actor);
    return true;
  });
  return found ? getInvoiceById(id) : null;
}

export async function addComment(id, note, actor) {
  const found = await withTransaction(async (client) => {
    const exists = await client.query('SELECT id FROM invoices WHERE id = $1', [id]);
    if (!exists.rows[0]) return false;
    await logActivity(client, id, 'comment', note, actor);
    return true;
  });
  return found ? getInvoiceById(id) : null;
}

export async function updateDueDate(id, dueDate, actor) {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw Object.assign(new Error('Due date must be a valid date.'), { status: 400 });
  }
  const found = await withTransaction(async (client) => {
    const prev = await client.query('SELECT due_date FROM invoices WHERE id = $1', [id]);
    if (!prev.rows[0]) return false;
    const previous = dateOnly(prev.rows[0].due_date);
    await client.query('UPDATE invoices SET due_date = $1 WHERE id = $2', [dueDate, id]);
    await logActivity(client, id, 'due_date_changed', `Due date changed from ${previous || 'n/a'} to ${dueDate}.`, actor);
    return true;
  });
  return found ? getInvoiceById(id) : null;
}

/**
 * Creates the invoice record from a resolved PO lookup — called right after
 * invoices/routes.js's upload handler has already confirmed the PO exists in
 * D365 or Odoo (see integrations/d365/client.js and
 * integrations/odoo/client.js's lookupPOForUpload). Everything about WHO
 * this invoice is from and WHICH subsidiary it belongs to comes from that
 * lookup, not from the uploader
 * (uploaders only ever type a PO number).
 *
 * The ERP-side line items are stored immediately, since they're already in
 * hand. Only the extracted (LLM) side is still pending — see saveExtraction
 * below, called once the async extraction pipeline finishes.
 */
export async function createInvoiceFromPOLookup({ poNumber, erpResult, fileStorageKey, fileMimeType, actor }) {
  const invoiceId = await withTransaction(async (client) => {
    const vendor = await findOrCreateVendor(client, erpResult.vendorName);
    const { rows } = await client.query(
      `INSERT INTO invoices (invoice_number, vendor_id, subsidiary, erp_source, currency, po_number, store_location, status,
                              extraction_confidence_notes, file_storage_key, file_mime_type,
                              erp_record_label, erp_record_reference, erp_subtotal, erp_tax_amount, erp_total_amount, erp_raw_response)
       VALUES ('PENDING-EXTRACTION', $1, $2, $3, 'NGN', $4, $5, 'pending', '', $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        vendor.id, erpResult.subsidiary, erpResult.erpSource, poNumber, erpResult.storeLocation || null,
        fileStorageKey || null, fileMimeType || null,
        erpResult.label, erpResult.reference, erpResult.subtotal, erpResult.tax_amount, erpResult.total_amount,
        JSON.stringify(erpResult.raw || null),
      ]
    );
    const newId = rows[0].id;

    for (const [idx, l] of erpResult.line_items.entries()) {
      await client.query(
        `INSERT INTO invoice_line_items (invoice_id, source, line_number, description, product_code, quantity, unit_price, line_total)
         VALUES ($1, 'erp', $2, $3, $4, $5, $6, $7)`,
        [newId, idx, l.description, l.product_code || null, l.quantity, l.unit_price ?? null, l.line_total]
      );
    }

    // Best-effort: link the standalone Purchase Order (what was ORDERED),
    // separate from the GRN/bill (what was RECEIVED/billed) already stored
    // above. Never blocks invoice creation — see getOrFetchPurchaseOrder's
    // own doc comment for why a miss here is a normal, non-fatal outcome.
    try {
      const po = await getOrFetchPurchaseOrder(client, poNumber, erpResult.erpSource);
      if (po) {
        await client.query('UPDATE invoices SET purchase_order_id = $1 WHERE id = $2', [po.header.id, newId]);
      }
    } catch (err) {
      console.warn(`[invoices] PO enrichment failed for ${poNumber}: ${err.message}`);
    }

    await logActivity(client, newId, 'uploaded', `Invoice uploaded for PO ${poNumber}. Matched to ${erpResult.label} (${erpResult.vendorName}).`, actor);
    await logActivity(client, newId, 'system', 'Invoice received and queued for extraction.', null);
    return newId;
  });
  return getInvoiceById(invoiceId);
}

/**
 * Runs once LLM extraction finishes (see integrations/llm/extract.js):
 * reads back the ERP side that was already stored at upload time, matches
 * the newly-extracted values against it, and persists both the extracted
 * fields and the match result in one transaction. This is also what a plain
 * retry re-runs (e.g. extraction failed transiently) — it never needs to
 * touch D365/Odoo again since that data is already on the row.
 */
export async function saveExtraction(invoiceId, { invoiceNumber, invoiceDate, extracted, provider, rawExtraction, tolerance }) {
  await withTransaction(async (client) => {
    const { rows: headerRows } = await client.query(
      `SELECT i.erp_subtotal, i.erp_tax_amount, i.erp_total_amount, v.default_tolerance_pct
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = $1`,
      [invoiceId]
    );
    if (!headerRows[0]) throw Object.assign(new Error('Invoice not found.'), { status: 404 });
    const { rows: erpLineRows } = await client.query(
      "SELECT description, product_code, quantity, unit_price, line_total FROM invoice_line_items WHERE invoice_id = $1 AND source = 'erp' ORDER BY line_number",
      [invoiceId]
    );

    const h = headerRows[0];
    // Falls back to the vendor's own default_tolerance_pct when the caller
    // doesn't pass one explicitly — processInvoiceAsync (the only real
    // caller) never did, which meant every match silently used the
    // hardcoded 1% default instead of the per-vendor tolerance that is
    // intended. Fixed here at the source
    // rather than requiring every caller to remember to look it up.
    const effectiveTolerance = tolerance ?? numOrNull(h.default_tolerance_pct);
    const erp = {
      subtotal: numOrNull(h.erp_subtotal),
      tax_amount: numOrNull(h.erp_tax_amount),
      total_amount: numOrNull(h.erp_total_amount),
      line_items: erpLineRows.map((l) => ({ ...l, quantity: numOrNull(l.quantity), unit_price: numOrNull(l.unit_price), line_total: numOrNull(l.line_total) })),
    };
    // priceUnavailable is true whenever every ERP line came back with no
    // price (the confirmed D365 receipt-line gap) — inferred here rather
    // than passed in, since by this point the ERP side is just DB rows.
    const priceUnavailable = erp.line_items.length > 0 && erp.line_items.every((l) => l.unit_price === null);

    const match = runMatch(extracted, erp, { tolerance: effectiveTolerance, priceUnavailable });

    await client.query(
      `UPDATE invoices SET
         invoice_number = $1, invoice_date = $2,
         extracted_subtotal = $3, extracted_tax_amount = $4, extracted_total_amount = $5,
         extraction_confidence_notes = $6, extraction_provider = $7, extraction_raw_response = $8,
         field_status = $9, discrepancies = $10, severity = $11
       WHERE id = $12`,
      [
        invoiceNumber, invoiceDate,
        extracted.subtotal, extracted.tax_amount, extracted.total_amount,
        extracted.confidence_notes || '', provider, JSON.stringify(rawExtraction || null),
        JSON.stringify(match.field_status), JSON.stringify(match.discrepancies), match.severity,
        invoiceId,
      ]
    );

    await client.query("DELETE FROM invoice_line_items WHERE invoice_id = $1 AND source = 'extracted'", [invoiceId]);
    const erpLineIdByDescription = {};
    {
      const { rows } = await client.query("SELECT id, description FROM invoice_line_items WHERE invoice_id = $1 AND source = 'erp'", [invoiceId]);
      for (const r of rows) erpLineIdByDescription[r.description] = r.id;
    }
    const extractedLineIdByDescription = {};
    for (const [idx, l] of extracted.line_items.entries()) {
      const comparison = match.lineComparison[idx];
      const { rows: insertedRows } = await client.query(
        `INSERT INTO invoice_line_items
           (invoice_id, source, line_number, description, product_code, quantity, unit_price, line_total,
            matched_line_id, qty_status, price_status, line_status)
         VALUES ($1, 'extracted', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          invoiceId, idx, l.description, l.product_code || null, l.quantity, l.unit_price ?? null, l.line_total,
          comparison?.erp ? erpLineIdByDescription[comparison.erp.description] || null : null,
          comparison?.qty_status || null, comparison?.price_status || null, comparison?.status || null,
        ]
      );
      extractedLineIdByDescription[l.description] = insertedRows[0].id;
    }

    // Invoice-vs-PO match — same tolerance, same matching engine, run right
    // after the GRN match above now that the 'extracted' line rows (and
    // their ids) exist. No-ops cleanly if this invoice has no linked PO.
    await computeAndStorePOMatch(client, invoiceId, extracted, extractedLineIdByDescription, effectiveTolerance);

    await logActivity(client, invoiceId, 'system', `Extraction complete via ${provider}.`, null);
  });
  return getInvoiceById(invoiceId);
}

/**
 * Manual, on-demand refresh: refetches this invoice's linked PO from the
 * real ERP right now — bypassing PO_REFRESH_TTL_HOURS entirely — and
 * re-runs the invoice-vs-PO match against whatever comes back. This is
 * distinct from the automatic TTL-based refresh inside
 * getOrFetchPurchaseOrder (purchase-orders/repository.js), which only ever
 * changes what the *next* invoice referencing that PO sees. This function
 * explicitly re-scores THIS invoice — a deliberate, logged human action,
 * not a background policy silently moving an already-computed verdict.
 *
 * Throws (400) if this invoice has no po_number at all, or hasn't finished
 * extraction yet (nothing to compare against a PO regardless of how fresh
 * it is). Returns null if the invoice itself doesn't exist. Does NOT throw
 * if the PO still can't be found after refetching — that's recorded in the
 * activity log and the invoice's poRecord simply stays null, same as any
 * other "PO not available" state.
 */
export async function refreshPurchaseOrder(invoiceId, actor) {
  const found = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT i.po_number, i.purchase_order_id,
              i.extracted_subtotal, i.extracted_tax_amount, i.extracted_total_amount,
              v.default_tolerance_pct
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id
       WHERE i.id = $1`,
      [invoiceId]
    );
    const inv = rows[0];
    if (!inv) return false;
    if (!inv.po_number) {
      throw Object.assign(new Error('This invoice has no PO number — nothing to refresh against.'), { status: 400 });
    }

    const { rows: extractedRows } = await client.query(
      `SELECT id, description, product_code, quantity, unit_price, line_total
       FROM invoice_line_items WHERE invoice_id = $1 AND source = 'extracted' ORDER BY line_number`,
      [invoiceId]
    );
    if (extractedRows.length === 0) {
      throw Object.assign(
        new Error("This invoice hasn't finished extraction yet — there's nothing to compare against the PO."),
        { status: 400 }
      );
    }

    // erpSourceHint is omitted (null): if a PO is already cached,
    // getOrFetchPurchaseOrder uses its own stored erp_source; if this is
    // the very first successful lookup for this po_number, it tries both
    // ERPs anyway. { force: true } bypasses the TTL check entirely.
    const po = await getOrFetchPurchaseOrder(client, inv.po_number, null, { force: true });
    if (po && !inv.purchase_order_id) {
      await client.query('UPDATE invoices SET purchase_order_id = $1 WHERE id = $2', [po.header.id, invoiceId]);
    }

    const extracted = {
      subtotal: numOrNull(inv.extracted_subtotal),
      tax_amount: numOrNull(inv.extracted_tax_amount),
      total_amount: numOrNull(inv.extracted_total_amount),
      line_items: extractedRows.map((l) => ({
        description: l.description,
        product_code: l.product_code,
        quantity: numOrNull(l.quantity),
        unit_price: numOrNull(l.unit_price),
        line_total: numOrNull(l.line_total),
      })),
    };
    const extractedLineIdByDescription = Object.fromEntries(extractedRows.map((l) => [l.description, l.id]));

    await computeAndStorePOMatch(client, invoiceId, extracted, extractedLineIdByDescription, numOrNull(inv.default_tolerance_pct));

    await logActivity(
      client, invoiceId, 'system',
      po
        ? `PO ${inv.po_number} refreshed manually by ${actor?.name || 'unknown'} — comparison re-run against current PO data.`
        : `PO ${inv.po_number} refresh attempted by ${actor?.name || 'unknown'}, but it still couldn't be found in either ERP.`,
      actor
    );
    return true;
  });
  if (!found) return null;
  // Re-read after commit, not inside the transaction — see the note above approveInvoice
  // on why getInvoiceById must never run against the transaction's own
  // in-flight connection.
  return getInvoiceById(invoiceId);
}

export { sum };
