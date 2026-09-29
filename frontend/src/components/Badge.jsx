import { SEVERITY_LABEL, STATUS_LABEL, ERP_LABEL } from "../lib/status";

export function SeverityBadge({ severity }) {
  if (!severity) return <span className="badge neutral">Not extracted</span>;
  return (
    <span className={`badge ${severity}`}>
      <span className="dot" />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

const STATUS_TONE = {
  pending: "neutral",
  approved: "match",
  rejected: "mismatch",
  blurry: "tolerance",
};

export function StatusBadge({ status }) {
  return (
    <span className={`badge ${STATUS_TONE[status] || "neutral"}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function ErpTag({ erpSource }) {
  return <span className="erp-tag">{ERP_LABEL[erpSource] || erpSource}</span>;
}
