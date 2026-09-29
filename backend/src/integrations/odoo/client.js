// Odoo integration (Acme Fresh subsidiary) — targets Odoo 19
// Enterprise on Odoo.sh. Kept intentionally lighter than the D365 client,
// since Odoo's data model is simpler and better documented. The one Odoo.sh-specific thing worth
// flagging is at the bottom of this file (external API access on Odoo.sh).
//
// Uses Odoo's standard external API (XML-RPC) — unchanged in shape across
// recent Odoo versions, including 19. A vendor bill is an account.move with
// move_type = 'in_invoice'; its lines are account.move.line.

import xmlrpc from './xmlrpc-client.js';

const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY } = process.env;

let cachedUid = null;

async function authenticate() {
  if (cachedUid) return cachedUid;
  if (!ODOO_URL || !ODOO_DB || !ODOO_USERNAME || !ODOO_API_KEY) {
    throw new Error('Odoo credentials are not configured (ODOO_URL / ODOO_DB / ODOO_USERNAME / ODOO_API_KEY).');
  }
  cachedUid = await xmlrpc.call(`${ODOO_URL}/xmlrpc/2/common`, 'authenticate', [
    ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {},
  ]);
  if (!cachedUid) throw new Error('Odoo authentication failed — check ODOO_DB / ODOO_USERNAME / ODOO_API_KEY.');
  return cachedUid;
}

async function execute(model, method, args) {
  const uid = await authenticate();
  return xmlrpc.call(`${ODOO_URL}/xmlrpc/2/object`, 'execute_kw', [
    ODOO_DB, uid, ODOO_API_KEY, model, method, args,
  ]);
}

/**
 * The entry point for the upload flow (Acme Fresh/Odoo side) — same shape and
 * calling convention as d365/client.js's lookupPOForUpload, so
 * invoices/routes.js can try one then the other without caring which
 * answered. Returns null if this PO isn't an Odoo PO at all.
 *
 * Unlike the D365 side, Odoo's vendor bill already carries everything
 * needed in one call — partner_id resolves straight to a vendor name via
 * XML-RPC's many2one [id, display_name] shape, and price_unit is always
 * present on a posted bill line. No "store location" concept applies to a
 * single-site Acme Fresh subsidiary the way it does for Acme Stores' multiple
 * stores, so that field is always null here.
 */
export async function lookupPOForUpload(poNumber) {
  const bills = await execute('account.move', 'search_read', [
    [
      ['move_type', '=', 'in_invoice'],
      ['invoice_origin', '=', poNumber],
      ['state', '=', 'posted'],
    ],
    ['id', 'name', 'partner_id', 'amount_untaxed', 'amount_tax', 'amount_total'],
  ]);
  if (bills.length === 0) return null;
  const bill = bills[0];

  const lines = await execute('account.move.line', 'search_read', [
    [
      ['move_id', '=', bill.id],
      ['exclude_from_invoice_tab', '=', false],
    ],
    ['name', 'product_id', 'quantity', 'price_unit', 'price_subtotal'],
  ]);

  return {
    erpSource: 'odoo',
    subsidiary: 'Acme Fresh',
    vendorName: Array.isArray(bill.partner_id) ? bill.partner_id[1] : 'Unknown vendor',
    storeLocation: null,
    label: 'Odoo bill',
    reference: bill.name,
    subtotal: bill.amount_untaxed,
    tax_amount: bill.amount_tax,
    total_amount: bill.amount_total,
    line_items: lines.map((l) => ({
      description: l.name,
      product_code: Array.isArray(l.product_id) ? String(l.product_id[0]) : null,
      quantity: l.quantity,
      unit_price: l.price_unit,
      line_total: l.price_subtotal,
    })),
    priceUnavailable: false, // Odoo bill lines always carry price_unit
    raw: { bill, lines },
  };
}

// --- Odoo.sh-specific note -------------------------------------------------
// External XML-RPC/JSON-RPC access works the same on Odoo.sh as any Odoo
// instance — no separate API gateway to configure. The two things worth
// double-checking in the Odoo.sh dashboard before this runs against the real
// branch: (1) which branch/URL this should point at (production vs a
// staging branch has separate data), and (2) that ODOO_USERNAME has an API
// key generated (Settings > Users > that user > Account Security), since
// Odoo 17+ rejects raw password XML-RPC auth for security by default.

/**
 * Fetches the standalone Purchase Order — the actual `purchase.order`
 * record (what was ordered), as opposed to lookupPOForUpload above, which
 * resolves a PO number to the vendor BILL raised against it. Unlike the
 * D365 side there's no field-name uncertainty here: purchase.order /
 * purchase.order.line are core Odoo models, unchanged in shape across
 * recent versions including 19.
 *
 * Matched by `name` first (Odoo's own PO number, e.g. "P00123") and falls
 * back to `partner_ref` (a free-text vendor reference field, in case
 * the company's PO numbers as printed on invoices are stored there instead;
 * the bill side has the same ambiguity).
 * Returns null if neither matches (caller then tries D365 — see
 * purchase-orders/repository.js).
 */
export async function fetchPurchaseOrder(poNumber) {
  let orders = await execute('purchase.order', 'search_read', [
    [['name', '=', poNumber]],
    ['id', 'name', 'partner_id', 'date_order', 'amount_untaxed', 'amount_tax', 'amount_total', 'currency_id'],
  ]);
  if (orders.length === 0) {
    orders = await execute('purchase.order', 'search_read', [
      [['partner_ref', '=', poNumber]],
      ['id', 'name', 'partner_id', 'date_order', 'amount_untaxed', 'amount_tax', 'amount_total', 'currency_id'],
    ]);
  }
  if (orders.length === 0) return null;
  const order = orders[0];

  const lines = await execute('purchase.order.line', 'search_read', [
    [
      ['order_id', '=', order.id],
      ['display_type', '=', false], // excludes section/note lines, which aren't real line items
    ],
    ['name', 'product_id', 'product_qty', 'price_unit', 'price_subtotal'],
  ]);

  return {
    po_number: poNumber,
    erp_source: 'odoo',
    vendor_name: Array.isArray(order.partner_id) ? order.partner_id[1] : 'Unknown vendor',
    subsidiary: 'Acme Fresh',
    currency: Array.isArray(order.currency_id) ? order.currency_id[1] : 'NGN',
    order_date: order.date_order ? order.date_order.slice(0, 10) : null,
    subtotal: order.amount_untaxed,
    tax_amount: order.amount_tax,
    total_amount: order.amount_total,
    line_items: lines.map((l, idx) => ({
      line_number: idx,
      description: l.name,
      product_code: Array.isArray(l.product_id) ? String(l.product_id[0]) : null,
      quantity: l.product_qty,
      unit_price: l.price_unit,
      line_total: l.price_subtotal,
    })),
    raw: { order, lines },
  };
}
