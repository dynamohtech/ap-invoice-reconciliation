// Tolerance-matching engine.
//
// This is a direct port of the algorithm already proven out in
// ap-recon-frontend/src/lib/mockData.js (fieldSeverity / buildLineComparison /
// buildInvoice). Keeping it byte-for-byte equivalent matters: the frontend's
// TESTING-GUIDE.md checklist encodes expected outcomes against that exact
// algorithm, and this backend needs to reproduce the same severities for the
// same inputs or the checklist stops being a valid acceptance test.
//
// Two deliberate extensions beyond the mock (both explained inline below):
//   1. Tolerance is per-vendor (vendors.default_tolerance_pct) instead of a
//      single hardcoded constant — the frontend's Vendor & Tolerance Admin
//      role already implies this is coming; the mock just hasn't needed it
//      yet because it only ever used one flat 1% value.
//   2. price_status has a fourth state, 'unavailable', used only when the ERP
//      side structurally has no price to compare (the confirmed D365 Product
//      Receipt gap). Everywhere else the
//      vocabulary is exactly match | tolerance | mismatch, same as the mock.

const DEFAULT_TOLERANCE = 0.01; // 1% — same default the mock uses

/**
 * Same semantics as mockData.js's fieldSeverity(a, b):
 *  - either side missing -> 'mismatch' (not a softer state — a genuinely
 *    unreadable/absent value on a field that's supposed to be there IS a
 *    discrepancy worth a human's attention)
 *  - exact equality -> 'match'
 *  - otherwise, relative difference against the ERP-side value (with a floor
 *    of 1 to avoid divide-by-near-zero blowups) compared to tolerance
 */
export function fieldSeverity(invoiceVal, erpVal, tolerance = DEFAULT_TOLERANCE) {
  if (invoiceVal === null || invoiceVal === undefined || erpVal === null || erpVal === undefined) {
    return 'mismatch';
  }
  if (invoiceVal === erpVal) return 'match';
  const diff = Math.abs(invoiceVal - erpVal);
  const base = Math.max(Math.abs(erpVal), 1);
  return diff / base <= tolerance ? 'tolerance' : 'mismatch';
}

/**
 * Line-level comparison. `priceUnavailable` should be true when the ERP
 * source for this invoice structurally cannot supply a unit price (today:
 * erp_source === 'd365', pending confirmation that the receipt entity truly
 * has no price field in the target tenant). When true,
 * price is excluded from both price_status and the line's overall status —
 * an absent field is not evidence of a mismatch.
 */
export function buildLineComparison(extractedLines, erpLines, { tolerance = DEFAULT_TOLERANCE, priceUnavailable = false } = {}) {
  return extractedLines.map((invLine) => {
    // Matched by product_code first when both sides have one (far more
    // reliable than free-text description matching);
    // falls back to exact description match, same as the mock.
    const match =
      (invLine.product_code && erpLines.find((e) => e.product_code && e.product_code === invLine.product_code)) ||
      erpLines.find((e) => e.description === invLine.description);

    if (!match) {
      return {
        description: invLine.description,
        product_code: invLine.product_code,
        invoice: invLine,
        erp: null,
        qty_status: null,
        price_status: null,
        status: 'mismatch',
        note: 'No matching line found',
      };
    }

    const qty_status = fieldSeverity(invLine.quantity, match.quantity, tolerance);
    const price_status = priceUnavailable
      ? 'unavailable'
      : fieldSeverity(invLine.unit_price, match.unit_price, tolerance);

    const relevantStatuses = priceUnavailable ? [qty_status] : [qty_status, price_status];
    const status = relevantStatuses.includes('mismatch')
      ? 'mismatch'
      : relevantStatuses.includes('tolerance')
      ? 'tolerance'
      : 'match';

    return {
      description: invLine.description,
      product_code: invLine.product_code,
      invoice: invLine,
      erp: match,
      qty_status,
      price_status,
      status,
    };
  });
}

function sum(lines) {
  return Math.round(lines.reduce((t, l) => t + Number(l.line_total || 0), 0) * 100) / 100;
}

/**
 * Runs the full match for one invoice: header totals + every line.
 * Returns everything invoices/repository.js needs to persist in one call —
 * this is the single place match results get computed, so it only ever runs
 * once per invoice (at match time), not recomputed on every GET, which
 * matters at 10,000+ invoices/month.
 *
 * @param {object} extracted  { subtotal, tax_amount, total_amount, line_items }
 * @param {object} erp        { subtotal, tax_amount, total_amount, line_items }
 * @param {object} opts       { tolerance, priceUnavailable }
 */
export function runMatch(extracted, erp, opts = {}) {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const priceUnavailable = Boolean(opts.priceUnavailable);
  // Purely cosmetic, for the discrepancy strings below — defaults to 'erp'
  // so the existing GRN comparison (and TESTING-GUIDE.md's checklist, which
  // was written against that exact wording) is byte-for-byte unchanged.
  // purchase-orders/repository.js passes 'po' so a PO-comparison
  // discrepancy reads "invoice=X, po=Y" rather than the misleading "erp=Y".
  const otherLabel = opts.otherLabel || 'erp';

  const erpHasData = erp && erp.line_items && erp.line_items.length > 0;

  const lineComparison = buildLineComparison(extracted.line_items, erp?.line_items || [], {
    tolerance,
    priceUnavailable,
  });

  const field_status = {
    subtotal: fieldSeverity(extracted.subtotal, erpHasData ? erp.subtotal : null, tolerance),
    tax_amount: fieldSeverity(extracted.tax_amount, erpHasData ? erp.tax_amount : null, tolerance),
    total_amount: fieldSeverity(extracted.total_amount, erpHasData ? erp.total_amount : null, tolerance),
  };

  const severities = [field_status.subtotal, field_status.tax_amount, field_status.total_amount, ...lineComparison.map((l) => l.status)];
  const severity = severities.includes('mismatch') ? 'mismatch' : severities.includes('tolerance') ? 'tolerance' : 'match';

  const recordWord = otherLabel === 'po' ? 'PO' : priceUnavailable ? 'receipt' : 'record';
  const discrepancies = [];
  lineComparison.forEach((l) => {
    if (!l.erp) {
      discrepancies.push(`No matching ${recordWord} line for: ${l.description}`);
      return;
    }
    if (l.qty_status === 'mismatch') {
      discrepancies.push(`Quantity mismatch on ${l.description}: invoice=${l.invoice.quantity}, ${otherLabel}=${l.erp.quantity}`);
    }
    if (l.price_status === 'mismatch') {
      discrepancies.push(`Price mismatch on ${l.description}: invoice=${Number(l.invoice.unit_price).toFixed(2)}, ${otherLabel}=${Number(l.erp.unit_price).toFixed(2)}`);
    }
  });
  if (field_status.total_amount === 'mismatch') {
    discrepancies.push(
      `Total mismatch: invoice=${Number(extracted.total_amount).toFixed(2)}, ${otherLabel}=${erpHasData && erp.total_amount != null ? Number(erp.total_amount).toFixed(2) : 'n/a'}`
    );
  }
  if (priceUnavailable) {
    discrepancies.push('ERP source has no per-line price to compare — price fields shown for reference only, not matched.');
  }

  return { severity, field_status, lineComparison, discrepancies };
}

export { sum, DEFAULT_TOLERANCE };
