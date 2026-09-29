import { useNavigate } from "react-router-dom";
import { formatMoney, formatAge } from "../lib/format";
import { SeverityBadge, StatusBadge, ErpTag } from "./Badge";

export default function InvoiceTable({ invoices }) {
  const navigate = useNavigate();

  if (invoices.length === 0) {
    return (
      <div className="table-wrap">
        <div className="empty-state">No invoices match these filters.</div>
      </div>
    );
  }

  function open(id) {
    navigate(`/invoices/${id}`);
  }

  return (
    <div className="table-wrap">
      <table className="queue">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Vendor</th>
            <th>Subsidiary</th>
            <th>ERP</th>
            <th className="num">Amount</th>
            <th>Status</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr
              key={inv.id}
              tabIndex={0}
              onClick={() => open(inv.id)}
              onKeyDown={(e) => e.key === "Enter" && open(inv.id)}
            >
              <td className="muted">{inv.invoice_number}</td>
              <td className="vendor">{inv.vendor_name}</td>
              <td className="muted">{inv.subsidiary}</td>
              <td>
                <ErpTag erpSource={inv.erp_source} />
              </td>
              <td className="num tabular-nums">
                {inv.extracted.total_amount != null
                  ? formatMoney(inv.extracted.total_amount, inv.currency)
                  : "—"}
              </td>
              <td>
                {inv.status === "pending" ? (
                  <SeverityBadge severity={inv.severity} />
                ) : (
                  <StatusBadge status={inv.status} />
                )}
              </td>
              <td className="muted">{formatAge(inv.submitted_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
