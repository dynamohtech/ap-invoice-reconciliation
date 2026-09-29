import { formatMoney } from "../lib/format";
import { SeverityBadge } from "./Badge";

const FIELDS = [
  { key: "subtotal", label: "Subtotal" },
  { key: "tax_amount", label: "VAT" },
  { key: "total_amount", label: "Total" },
];

export default function ComparisonPanel({ invoice }) {
  const erpLabel = invoice.erpRecord.label;

  if (invoice.status === "blurry") {
    return (
      <div className="comparison-table">
        <div className="row head">
          <span>Field</span>
          <span>Invoice</span>
          <span>{erpLabel}</span>
          <span></span>
        </div>
        <div className="empty-state">
          Nothing to compare — extraction didn't run on an unreadable scan.
        </div>
      </div>
    );
  }

  return (
    <>
      {invoice.extracted.confidence_notes && (
        <p className="confidence-note">{invoice.extracted.confidence_notes}</p>
      )}

      <div className="comparison-table">
        <div className="row head">
          <span>Field</span>
          <span>Invoice</span>
          <span>{erpLabel}</span>
          <span></span>
        </div>

        {FIELDS.map((f) => (
          <div className="row" key={f.key}>
            <span className="field-name">{f.label}</span>
            <span className="tabular-nums">{formatMoney(invoice.extracted[f.key], invoice.currency)}</span>
            <span className="tabular-nums">
              {invoice.erpRecord[f.key] != null
                ? formatMoney(invoice.erpRecord[f.key], invoice.currency)
                : "Not found"}
            </span>
            <span className="status-cell">
              <SeverityBadge severity={invoice.fieldStatus[f.key]} />
            </span>
          </div>
        ))}

        {invoice.lineComparison.map((l, i) => (
          <div className="row line-item" key={i}>
            <span className="field-name">{l.description}</span>
            <span className="tabular-nums">
              {l.invoice.quantity} × {formatMoney(l.invoice.unit_price, invoice.currency)}
            </span>
            <span className="tabular-nums">
              {l.erp ? `${l.erp.quantity} × ${formatMoney(l.erp.unit_price, invoice.currency)}` : "No matching line"}
            </span>
            <span className="status-cell">
              <SeverityBadge severity={l.status} />
            </span>
          </div>
        ))}
      </div>

      {invoice.erp_source === "d365" && (
        <p className="confidence-note">
          D365 Product Receipts may not carry a unit price field, depending on how the environment is
          configured. Treat price columns above as provisional until the entity discovery tool has run
          against the real tenant.
        </p>
      )}

      {invoice.discrepancies.length > 0 && (
        <div className="panel">
          <h2>Flagged discrepancies</h2>
          <ul className="discrepancy-list">
            {invoice.discrepancies.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
