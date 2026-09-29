export const SEVERITY_LABEL = {
  match: "Matched",
  tolerance: "Within tolerance",
  mismatch: "Mismatch",
};

export const STATUS_LABEL = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  blurry: "Unreadable",
};

export const ERP_LABEL = {
  odoo: "Odoo",
  d365: "Dynamics 365",
};

export const ERP_RECORD_LABEL = {
  odoo: "Odoo bill",
  d365: "D365 Product Receipt",
};

export const ROLE_LABEL = {
  reviewer: "Reviewer",
  approver: "Approver",
  vendor_tolerance_admin: "Vendor & Tolerance Admin",
  auditor: "Auditor",
  system_admin: "System Admin",
};

export const ROLE_IDS = Object.keys(ROLE_LABEL);

// Worst-of ordering used to roll per-field statuses up into one
// invoice-level severity.
const SEVERITY_RANK = { match: 0, tolerance: 1, mismatch: 2 };

export function worstSeverity(statuses) {
  return statuses.reduce(
    (worst, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[worst] ? s : worst),
    "match"
  );
}
