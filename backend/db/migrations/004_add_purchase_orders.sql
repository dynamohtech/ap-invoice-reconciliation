-- AP Reconciliation — standalone Purchase Order records
--
-- Why this exists: until now, "the ERP side" of an invoice was always the
-- goods-received record (an Odoo vendor bill or a D365 Product Receipt —
-- see erp_record_label/erp_subtotal/etc. on invoices, and
-- po_line_price_cache below). That's a GRN-shaped comparison. The frontend
-- now also wants a genuinely separate invoice-vs-PURCHASE-ORDER comparison
-- (what was ordered, at what price) — a different question with a
-- different answer, most usefully different exactly when a receipt is
-- partial or a PO price has drifted from what was actually received. See
-- ap-recon-frontend's src/lib/mockData.js (poRecord / poLineComparison)
-- for the exact shape this schema needs to reproduce.
--
-- Design choice: a PO is modeled as its own standalone entity
-- (purchase_orders / purchase_order_lines), NOT as a third `source` value
-- bolted onto invoice_line_items. Two reasons:
--   1. A single PO can legitimately back multiple invoices (partial
--      deliveries, split billing) — per-invoice duplication would mean
--      re-fetching and re-storing the same PO lines under every invoice
--      that references them, and they'd drift out of sync with each other.
--   2. It mirrors po_line_price_cache's original intent (see its comment
--      in 001_init.sql) but does it properly: a full header + every line,
--      not just a per-line price lookup. po_line_price_cache is left in
--      place (it's harmless, and nothing here depends on it), but this
--      table is what actually gets used for PO comparison going forward —
--      po_line_price_cache was never wired into any code path.
--
-- Per-invoice PO comparison RESULTS (field_status-equivalent, discrepancy
-- list, per-line match) still live per-invoice, same as the existing GRN
-- comparison — a shared PO can validly compare differently against two
-- different invoices raised against it (e.g. one invoice covers the full
-- PO, another only a partial shipment).

-- ---------------------------------------------------------------------------
-- Purchase orders (header) — one row per real-world PO, keyed by po_number.
-- Fetched from D365 (PurchaseOrderHeadersV2 + PurchaseOrderLinesV2) or Odoo
-- (purchase.order + purchase.order.line) the first time any invoice
-- references that PO number, then reused — see
-- src/purchase-orders/repository.js.
-- ---------------------------------------------------------------------------

CREATE TABLE purchase_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number       TEXT NOT NULL UNIQUE,
    erp_source      TEXT NOT NULL CHECK (erp_source IN ('odoo', 'd365')),
    vendor_name     TEXT,
    subsidiary      TEXT,
    currency        TEXT NOT NULL DEFAULT 'NGN',
    order_date      DATE,
    -- Nullable on purpose: D365's PurchaseOrderHeadersV2 field names for a
    -- header-level total are NOT confirmed against a real tenant (same
    -- caveat as erp_total_amount for Product Receipts — see
    -- integrations/d365/client.js). subtotal is always derivable from the
    -- lines regardless; tax/total may be null until confirmed.
    subtotal        NUMERIC(14,2),
    tax_amount      NUMERIC(14,2),
    total_amount    NUMERIC(14,2),
    raw_response    JSONB,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_purchase_orders_po_number ON purchase_orders (po_number);

CREATE TABLE purchase_order_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    line_number         INTEGER NOT NULL,
    description         TEXT NOT NULL,
    product_code        TEXT,
    quantity             NUMERIC(14,3),  -- quantity ORDERED, not received
    unit_price           NUMERIC(14,4),
    line_total            NUMERIC(14,2),
    UNIQUE (purchase_order_id, line_number)
);
CREATE INDEX idx_po_lines_purchase_order_id ON purchase_order_lines (purchase_order_id);

CREATE TRIGGER trg_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Invoice <-> PO linkage + per-invoice comparison result. Mirrors the
-- existing erp_record_*/field_status/discrepancies columns on invoices,
-- one field set removed since the PO record itself is normalized out above.
-- ---------------------------------------------------------------------------

ALTER TABLE invoices
    ADD COLUMN purchase_order_id UUID REFERENCES purchase_orders(id),
    ADD COLUMN po_field_status   JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN po_discrepancies  JSONB NOT NULL DEFAULT '[]';

CREATE INDEX idx_invoices_purchase_order_id ON invoices (purchase_order_id);

-- Per-line PO match result, computed at the same time (and the same way —
-- see src/invoices/matching.js's runMatch, reused as-is) as the existing
-- extracted-vs-erp line match on invoice_line_items. Kept as its own table
-- rather than adding a fourth `source` to invoice_line_items because the
-- "other side" of this comparison (purchase_order_lines) is a normalized,
-- possibly-shared table, not a per-invoice copy.
CREATE TABLE invoice_po_line_matches (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id              UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    invoice_line_item_id    UUID NOT NULL REFERENCES invoice_line_items(id) ON DELETE CASCADE, -- the 'extracted' line
    purchase_order_line_id  UUID REFERENCES purchase_order_lines(id), -- NULL: no matching PO line found
    qty_status              TEXT CHECK (qty_status IN ('match', 'tolerance', 'mismatch')),
    price_status            TEXT CHECK (price_status IN ('match', 'tolerance', 'mismatch', 'unavailable')),
    line_status              TEXT CHECK (line_status IN ('match', 'tolerance', 'mismatch')),
    UNIQUE (invoice_id, invoice_line_item_id)
);
CREATE INDEX idx_invoice_po_matches_invoice_id ON invoice_po_line_matches (invoice_id);
