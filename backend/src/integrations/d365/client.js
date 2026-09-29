// D365 Finance & Operations integration (Acme Stores subsidiary).
//
// UPLOAD FLOW (per corrected design): the uploader supplies ONLY a PO number
// + the file — no subsidiary, no vendor name. lookupPOForUpload() below is
// the entry point: it calls the header endpoint and the line-items endpoint
// (two separate D365 calls, as described) and returns vendor name, store/
// receiving location, and subsidiary alongside the line data, so
// invoices/routes.js can create the invoice record without asking the human
// for anything else.
//
// CONFIRMED via Microsoft's own Common Data Model schema docs (checked
// directly against learn.microsoft.com):
//   - VendProductReceiptHeaderEntity's documented fields are ProductReceiptNumber,
//     PurchaseOrderNumber, ProductReceiptDate, OrderVendorAccountNumber (an
//     ACCOUNT NUMBER, not a friendly name), RequesterPersonnelNumber,
//     AttentionInformation, plus delivery-address fields — no line-item
//     price field anywhere, and no obvious "store name" field either.
//   - VendProductReceiptLineEntity has quantities only, no price.
// NOT CONFIRMED (couldn't be — no access to a real tenant while
// building this): that a friendly vendor NAME and a "store location code
// name" actually appear on this entity in a given customer's environment. Either the
// real tenant has custom fields added (common for a customized F&O
// deployment), or "vendor name" here really means the vendor account
// number and a separate Vendors-entity lookup resolves it to a name, or
// "store location" comes from a site/warehouse field this entity doesn't
// document publicly. pickField() below tries several plausible field names
// and keeps the full raw response either way, specifically so this doesn't
// silently fail once real data arrives — but treat the exact field names as
// unconfirmed until `npm run discover-d365` (scripts/find-d365-entity.js) has
// run against the real tenant.
//
// A PO can have MULTIPLE Product Receipts against it (partial deliveries) —
// lookupPOForUpload aggregates received quantity across every receipt
// posted against the PO. This assumes invoices are raised against the full
// PO rather than one partial shipment at a time — confirm with the AP
// team before trusting it on a partially-invoiced PO.

import { ConfidentialClientApplication } from '@azure/msal-node';

const {
  D365_TENANT_ID,
  D365_CLIENT_ID,
  D365_CLIENT_SECRET,
  D365_ENVIRONMENT_URL, // e.g. https://your-org.operations.dynamics.com
} = process.env;

let msalApp = null;
function getMsalApp() {
  if (!D365_TENANT_ID || !D365_CLIENT_ID || !D365_CLIENT_SECRET) {
    throw new Error('D365 credentials are not configured (D365_TENANT_ID / D365_CLIENT_ID / D365_CLIENT_SECRET).');
  }
  if (!msalApp) {
    msalApp = new ConfidentialClientApplication({
      auth: {
        clientId: D365_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${D365_TENANT_ID}`,
        clientSecret: D365_CLIENT_SECRET,
      },
    });
  }
  return msalApp;
}

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;
  const app = getMsalApp();
  const result = await app.acquireTokenByClientCredential({
    scopes: [`${D365_ENVIRONMENT_URL}/.default`],
  });
  cachedToken = result.accessToken;
  cachedTokenExpiresAt = result.expiresOn ? result.expiresOn.getTime() : Date.now() + 55 * 60 * 1000;
  return cachedToken;
}

async function odataGet(entitySet, odataQuery) {
  const token = await getAccessToken();
  const url = `${D365_ENVIRONMENT_URL}/data/${entitySet}${odataQuery}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`D365 OData request failed (${res.status}) for ${entitySet}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  return json.value || [];
}

function escapeOData(value) {
  return String(value).replace(/'/g, "''");
}

/** Returns the first field present on `record` from a list of candidate
 * names — see the file header on why this is a list, not one confirmed name. */
function pickField(record, candidates) {
  for (const name of candidates) {
    if (record[name] !== undefined && record[name] !== null && record[name] !== '') return record[name];
  }
  return null;
}

function buildLineItemsFromReceiptLines(receiptLines, poLines) {
  const priceByPoLine = new Map(
    poLines.map((l) => [l.LineNumber ?? l.PurchaseOrderLineNumber, Number(l.PurchasePrice ?? l.UnitPrice ?? 0)])
  );

  const qtyByPoLine = new Map();
  const infoByPoLine = new Map();
  for (const l of receiptLines) {
    const key = l.PurchaseOrderLineNumber;
    qtyByPoLine.set(key, (qtyByPoLine.get(key) || 0) + Number(l.ReceivedPurchaseQuantity ?? l.ReceivedInventoryQuantity ?? 0));
    if (!infoByPoLine.has(key)) {
      infoByPoLine.set(key, { description: l.LineDescription, product_code: l.ItemNumber || l.ProductNumber || null });
    }
  }

  return [...qtyByPoLine.entries()].map(([poLineNumber, quantity]) => {
    const info = infoByPoLine.get(poLineNumber);
    const unitPrice = priceByPoLine.has(poLineNumber) ? priceByPoLine.get(poLineNumber) : null;
    return {
      description: info.description,
      product_code: info.product_code,
      quantity,
      unit_price: unitPrice,
      line_total: unitPrice !== null ? Math.round(quantity * unitPrice * 100) / 100 : null,
    };
  });
}

/**
 * The entry point for the upload flow. Two D365 calls, as described: the
 * header endpoint (VendProductReceiptHeaders — vendor/store/PO context) and
 * the line-items endpoint (VendProductReceiptLines — quantities), plus
 * PurchaseOrderLinesV2 for price (receipt lines don't carry it — see file
 * header). Returns null if the PO simply isn't a D365 PO at all (the caller
 * then tries Odoo — see integrations/odoo/client.js and invoices/routes.js).
 */
export async function lookupPOForUpload(poNumber) {
  const [headers, lines, poLines] = await Promise.all([
    odataGet('VendProductReceiptHeaders', `?$filter=PurchaseOrderNumber eq '${escapeOData(poNumber)}'`),
    odataGet('VendProductReceiptLines', `?$filter=PurchaseOrderNumber eq '${escapeOData(poNumber)}'`),
    odataGet('PurchaseOrderLinesV2', `?$filter=PurchaseOrderNumber eq '${escapeOData(poNumber)}'`),
  ]);

  if (headers.length === 0) return null;
  const header = headers[0];

  // See file header: these two are the ones NOT confirmed against a real
  // tenant. Candidates are ordered most-to-least likely based on common F&O
  // naming conventions; fix once discovery confirms the real names.
  const vendorName = pickField(header, ['OrderVendorAccountName', 'VendorName', 'OrderVendorAccountNumber']);
  const storeLocation = pickField(header, ['StoreName', 'StoreLocation', 'ReceivingSiteId', 'ReceivingWarehouseId', 'DeliveryAddressStateId']);

  const line_items = buildLineItemsFromReceiptLines(lines, poLines);
  const subtotal = line_items.length && line_items.every((l) => l.line_total !== null)
    ? Math.round(line_items.reduce((t, l) => t + l.line_total, 0) * 100) / 100
    : null;

  return {
    erpSource: 'd365',
    subsidiary: 'Acme Stores',
    vendorName: vendorName || 'Unknown vendor (D365 field unconfirmed — see client.js header)',
    storeLocation,
    label: `D365 Product Receipt${headers.length > 1 ? ` (${headers.length} receipts aggregated)` : ''}`,
    reference: headers.map((h) => h.ProductReceiptNumber).join(', '),
    subtotal,
    tax_amount: null, // not present on the receipt entity — see file header
    total_amount: null,
    line_items,
    priceUnavailable: true,
    raw: { headers, lines, poLines },
  };
}

/**
 * Fetches the standalone Purchase Order itself — what was ORDERED, not what
 * was received. Separate from lookupPOForUpload above on purpose: that one
 * answers "what arrived" (a Product Receipt); this answers "what was
 * agreed" (the PO), which is what a genuine invoice-vs-PO comparison needs.
 * See db/migrations/004_add_purchase_orders.sql for why this is persisted
 * as its own entity rather than folded into the receipt comparison.
 *
 * CONFIRMED: PurchaseOrderLinesV2 is already used above for price backfill,
 * so PurchaseOrderNumber / LineNumber / PurchasePrice on that entity are
 * known-good. NOT CONFIRMED: PurchaseOrderHeadersV2's field names below —
 * this entity set was anticipated (see scripts/find-d365-entity.js, which
 * already checks it) but never actually queried until now. pickField()
 * candidates are ordered by likelihood per common F&O naming; run
 * `npm run discover-d365 -- <PO number>` against the real tenant to confirm
 * before trusting the header-level totals here (line-level totals are
 * computed from PurchaseOrderLinesV2 directly and don't have this problem).
 *
 * Returns null if D365 has no PO under this number at all (caller then
 * tries Odoo — see purchase-orders/repository.js).
 */
export async function fetchPurchaseOrder(poNumber) {
  const [headers, lines] = await Promise.all([
    odataGet('PurchaseOrderHeadersV2', `?$filter=PurchaseOrderNumber eq '${escapeOData(poNumber)}'`),
    odataGet('PurchaseOrderLinesV2', `?$filter=PurchaseOrderNumber eq '${escapeOData(poNumber)}'`),
  ]);
  if (headers.length === 0) return null;
  const header = headers[0];

  const vendorName = pickField(header, ['OrderVendorAccountName', 'VendorName', 'PurchaseOrderVendorAccountNumber', 'OrderVendorAccountNumber']);
  const orderDate = pickField(header, ['PurchaseOrderDate', 'OrderDate', 'ConfirmedShippingDate']);
  const currency = pickField(header, ['CurrencyCode', 'OrderCurrencyCode']) || 'NGN';
  // Header-level totals: unconfirmed field names (see function comment above)
  // — left null rather than guessed wrong. subtotal is instead computed from
  // the lines directly by the caller, which needs no guessing.
  const headerTotal = pickField(header, ['PurchaseTotalAmount', 'TotalAmount', 'OrderTotalAmount']);

  const line_items = lines
    .map((l) => {
      const quantity = Number(l.PurchaseQuantity ?? l.OrderedPurchaseQuantity ?? 0);
      const unitPrice = l.PurchasePrice !== undefined && l.PurchasePrice !== null ? Number(l.PurchasePrice) : null;
      return {
        line_number: l.LineNumber ?? l.PurchaseOrderLineNumber,
        description: l.LineDescription || l.ItemName || l.ProductName || '(no description)',
        product_code: l.ItemNumber || l.ProductNumber || null,
        quantity,
        unit_price: unitPrice,
        line_total: unitPrice !== null ? Math.round(quantity * unitPrice * 100) / 100 : null,
      };
    })
    .sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0));

  const subtotal = line_items.length && line_items.every((l) => l.line_total !== null)
    ? Math.round(line_items.reduce((t, l) => t + l.line_total, 0) * 100) / 100
    : null;

  return {
    po_number: poNumber,
    erp_source: 'd365',
    vendor_name: vendorName || 'Unknown vendor (D365 field unconfirmed — see client.js header)',
    subsidiary: 'Acme Stores',
    currency,
    order_date: orderDate,
    subtotal,
    tax_amount: null, // unconfirmed — see comment above
    total_amount: numOrNull(headerTotal),
    line_items,
    raw: { headers, lines },
  };
}

function numOrNull(v) {
  return v === null || v === undefined || v === '' ? null : Number(v);
}
