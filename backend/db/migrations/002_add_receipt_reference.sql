-- Adds a second, more precise matching key alongside po_number.
--
-- Why this exists: (1) a real uploaded invoice frequently does NOT print a
-- PO number at all — only whatever the supplier's own delivery note/waybill
-- says; (2) even when a PO number IS available, one PO can have several
-- goods receipts against it (partial deliveries), so "the GRN for PO X" is
-- not a single unambiguous record. The tiered matching strategy this
-- column supports:
--   1. delivery_reference present -> fetch that ONE specific D365 Product
--      Receipt by ProductReceiptNumber (no ambiguity)
--   2. else po_number present -> aggregate ALL receipts against that PO
--      (assumes invoices are raised against the full PO, not partial
--      shipments — flagged as an assumption to confirm with the AP team)
--   3. else -> invoice stays 'pending' with severity NULL and a discrepancy
--      note asking a reviewer to supply one manually (PATCH .../po-number)
--
-- We never edit 001_init.sql after it's been applied anywhere — this is a
-- new migration instead, same as any real change would be post-launch.

ALTER TABLE invoices ADD COLUMN receipt_reference TEXT;
CREATE INDEX idx_invoices_receipt_reference ON invoices (receipt_reference);
