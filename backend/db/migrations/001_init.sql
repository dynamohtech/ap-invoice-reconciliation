-- AP Reconciliation — initial schema
-- Target: PostgreSQL 18 (tested locally on PostgreSQL 16, which supports every
-- feature used here — gen_random_uuid() has been built into core since PG13).
--
-- Design notes:
--   * Surrogate UUID primary keys throughout (gen_random_uuid()), so future SSO
--     external IDs or multi-source merges never collide with human-readable codes.
--   * invoice_number / po_number are NOT unique — a resubmitted duplicate must be
--     allowed INTO the table so it can be reviewed and rejected as a duplicate
--     (see mock scenario inv_005). Duplicate detection is an application-level
--     check, not a DB constraint. They are still heavily indexed for fast lookup.
--   * unit_price on line items is NULLABLE on purpose: D365 Product Receipt lines
--     do not carry a price field (confirmed against Microsoft's own CDM schema).
--     Do not add a NOT NULL constraint here.
--   * discrepancies / field_status are JSONB, matching the shape the frontend
--     already renders (see src/lib/mockData.js). They are not queried by
--     sub-field today, so normalizing them into their own table would add
--     complexity with no current payoff — a possible future option.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- harmless if gen_random_uuid() is already core; keeps this portable to older PG

-- ---------------------------------------------------------------------------
-- Users & sessions
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN (
                        'reviewer', 'approver', 'vendor_tolerance_admin',
                        'auditor', 'system_admin'
                    )),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session tokens are stored as a SHA-256 hash, never the raw token — mirrors how
-- password_hash works, so a DB leak alone can't be replayed as a live session.
CREATE TABLE sessions (
    token_hash      TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Vendors — normalized out of the invoice row so a per-vendor tolerance
-- override has somewhere to live (the "Vendor & Tolerance Admin" role already
-- exists in the frontend's RBAC model; this is the table its future screen
-- would read/write).
-- ---------------------------------------------------------------------------

CREATE TABLE vendors (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL UNIQUE,
    default_tolerance_pct   NUMERIC(6,4) NOT NULL DEFAULT 0.0100, -- 1%, matches mockData.js TOLERANCE
    contact_email           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Subsidiary -> ERP map (mirrors adminData.js exactly)
-- ---------------------------------------------------------------------------

CREATE TABLE subsidiary_erp_map (
    subsidiary      TEXT PRIMARY KEY,
    erp             TEXT CHECK (erp IN ('odoo', 'd365')),
    confirmed       BOOLEAN NOT NULL DEFAULT false,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Invoices (header)
-- ---------------------------------------------------------------------------

CREATE TABLE invoices (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number              TEXT NOT NULL,
    vendor_id                   UUID NOT NULL REFERENCES vendors(id),
    subsidiary                  TEXT NOT NULL,
    erp_source                  TEXT NOT NULL CHECK (erp_source IN ('odoo', 'd365')),
    currency                    TEXT NOT NULL DEFAULT 'NGN',
    invoice_date                DATE,
    due_date                    DATE,
    po_number                   TEXT,
    submitted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    status                      TEXT NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'approved', 'rejected', 'blurry')),
    severity                    TEXT CHECK (severity IN ('match', 'tolerance', 'mismatch')),

    -- extracted (vision-LLM) side
    extracted_subtotal          NUMERIC(14,2),
    extracted_tax_amount        NUMERIC(14,2),
    extracted_total_amount      NUMERIC(14,2),
    extraction_confidence_notes TEXT NOT NULL DEFAULT '',
    extraction_provider         TEXT, -- 'gemini' | 'azure_openai' | 'manual'
    extraction_raw_response     JSONB,

    -- ERP side (Odoo bill or D365 Product Receipt + PO Line price reference)
    erp_record_label            TEXT,
    erp_record_reference        TEXT,
    erp_subtotal                NUMERIC(14,2),
    erp_tax_amount               NUMERIC(14,2),
    erp_total_amount            NUMERIC(14,2),
    erp_raw_response            JSONB,

    -- computed at match time, then stored (never recomputed silently on read)
    field_status                 JSONB NOT NULL DEFAULT '{}',
    discrepancies                 JSONB NOT NULL DEFAULT '[]',

    file_storage_key             TEXT,   -- key/path in file storage, not a URL (see src/upload/storage.js)
    file_mime_type                TEXT,

    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Search & filter indexes. invoice_number / po_number are the two the finance
-- team will search by — plain B-tree covers exact and
-- prefix search; pg_trgm (below) adds substring search.
CREATE INDEX idx_invoices_invoice_number ON invoices (invoice_number);
CREATE INDEX idx_invoices_po_number ON invoices (po_number);
CREATE INDEX idx_invoices_status ON invoices (status);
CREATE INDEX idx_invoices_severity ON invoices (severity);
CREATE INDEX idx_invoices_subsidiary ON invoices (subsidiary);
CREATE INDEX idx_invoices_erp_source ON invoices (erp_source);
CREATE INDEX idx_invoices_vendor_id ON invoices (vendor_id);
CREATE INDEX idx_invoices_submitted_at ON invoices (submitted_at DESC);
-- Composite index for the single most common screen: the pending review queue
CREATE INDEX idx_invoices_status_submitted ON invoices (status, submitted_at DESC);

-- Substring search ("contains", not just prefix) on invoice/PO number at scale.
-- Optional but recommended once volume climbs.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_invoices_invoice_number_trgm ON invoices USING GIN (invoice_number gin_trgm_ops);
CREATE INDEX idx_invoices_po_number_trgm ON invoices USING GIN (po_number gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Line items — both the extracted (invoice) side and the erp side live in one
-- table distinguished by `source`, so a line and its matched counterpart can
-- reference each other directly.
-- ---------------------------------------------------------------------------

CREATE TABLE invoice_line_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id        UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    source            TEXT NOT NULL CHECK (source IN ('extracted', 'erp')),
    line_number        INTEGER NOT NULL,
    description        TEXT NOT NULL,
    product_code       TEXT,
    quantity           NUMERIC(14,3),
    unit_price         NUMERIC(14,4), -- NULLABLE: D365 receipt lines may not carry this — see note above
    line_total          NUMERIC(14,2),
    matched_line_id      UUID REFERENCES invoice_line_items(id),
    -- Vocabulary matches src/lib/mockData.js's fieldSeverity() exactly: match |
    -- tolerance | mismatch. 'unavailable' is the one deliberate addition, used
    -- ONLY for price_status, ONLY when the ERP side structurally has no price
    -- to compare (the confirmed D365 Product Receipt gap).
    -- It means "nothing to compare", which is a different fact than "compared
    -- and it didn't match" — collapsing the two into 'mismatch' would flag a
    -- false discrepancy on every single D365 line. qty_status and line_status
    -- stay exactly as the frontend already expects, no added states.
    qty_status          TEXT CHECK (qty_status IN ('match', 'tolerance', 'mismatch')),
    price_status        TEXT CHECK (price_status IN ('match', 'tolerance', 'mismatch', 'unavailable')),
    line_status          TEXT CHECK (line_status IN ('match', 'tolerance', 'mismatch'))
);
CREATE INDEX idx_line_items_invoice_id ON invoice_line_items (invoice_id);
CREATE INDEX idx_line_items_invoice_source ON invoice_line_items (invoice_id, source);

-- ---------------------------------------------------------------------------
-- Activity log — append-only audit trail per invoice
-- ---------------------------------------------------------------------------

CREATE TABLE activity_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN (
                        'system', 'comment', 'approved', 'rejected',
                        'requested_info', 'due_date_changed', 'uploaded'
                    )),
    author_user_id  UUID REFERENCES users(id), -- NULL for system-generated entries
    author_name     TEXT NOT NULL,             -- denormalized snapshot: survives user renames/removal
    author_role     TEXT NOT NULL,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_invoice_id ON activity_log (invoice_id, created_at);

-- ---------------------------------------------------------------------------
-- Purchase order line cache. D365 Product
-- Receipt lines don't carry price, so price truth for the D365 path comes
-- from PurchaseOrderLinesV2 instead. This table caches those fetches so a
-- second invoice against the same PO doesn't re-hit D365, and keeps a durable
-- record of the price that was actually seen at match time (D365 prices can
-- change on the PO after the fact; the invoice's match should reflect what was
-- true when it was matched, not what's true today).
-- ---------------------------------------------------------------------------

CREATE TABLE po_line_price_cache (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number       TEXT NOT NULL,
    po_line_number  INTEGER NOT NULL,
    item_number     TEXT,
    description     TEXT,
    unit_price      NUMERIC(14,4),
    currency        TEXT,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_response    JSONB,
    UNIQUE (po_number, po_line_number)
);
CREATE INDEX idx_po_cache_po_number ON po_line_price_cache (po_number);

-- ---------------------------------------------------------------------------
-- updated_at auto-touch trigger (applied to the tables that need it)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_vendors_updated_at BEFORE UPDATE ON vendors
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
