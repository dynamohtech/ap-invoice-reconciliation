-- Supports the corrected upload flow: the uploader supplies ONLY a PO
-- number (+ the file). Vendor name and subsidiary are no longer typed in —
-- both come back from the PO header lookup itself, which also exposes a
-- more granular store/receiving-location than the existing `subsidiary`
-- column captures (subsidiary stays "Acme Fresh" / "Acme Stores"; an Acme
-- Stores PO is additionally tied to one specific store).

ALTER TABLE invoices ADD COLUMN store_location TEXT;
