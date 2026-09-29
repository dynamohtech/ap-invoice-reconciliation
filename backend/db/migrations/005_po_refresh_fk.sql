-- Enables PO refresh (see purchase-orders/repository.js's TTL-based
-- getOrFetchPurchaseOrder and the manual refreshPurchaseOrderForInvoice).
--
-- Until now, purchase_orders/purchase_order_lines were fetched once and
-- never touched again, so invoice_po_line_matches.purchase_order_line_id's
-- default ON DELETE RESTRICT was harmless — nothing ever deleted a
-- purchase_order_lines row. That's no longer true: a refresh can remove a
-- line that a genuine PO amendment dropped, and RESTRICT would then block
-- the refresh outright the moment any invoice had ever matched against
-- that line.
--
-- This does NOT weaken the audit trail. The actual verdict for an
-- already-matched invoice — qty_status / price_status / line_status, and
-- the invoice-level po_field_status / po_discrepancies on `invoices` — are
-- already immutable, computed once and only ever rewritten by an explicit
-- re-match (extraction, or the manual refresh action). Losing the FK
-- pointer on a since-removed line doesn't touch any of that; it only means
-- a live "what does this PO line look like today" join comes back empty
-- for that one line, which read-side code already treats as "no matching
-- PO line" (the same state a line that was never matched shows).
ALTER TABLE invoice_po_line_matches
    DROP CONSTRAINT invoice_po_line_matches_purchase_order_line_id_fkey,
    ADD CONSTRAINT invoice_po_line_matches_purchase_order_line_id_fkey
        FOREIGN KEY (purchase_order_line_id) REFERENCES purchase_order_lines(id) ON DELETE SET NULL;
