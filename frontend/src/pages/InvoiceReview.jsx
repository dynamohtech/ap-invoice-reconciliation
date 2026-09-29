import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getInvoiceById } from "../lib/api";
import { formatMoney } from "../lib/format";
import { ErpTag, StatusBadge, SeverityBadge } from "../components/Badge";
import InvoiceDocument from "../components/InvoiceDocument";
import ComparisonPanel from "../components/ComparisonPanel";
import ActionBar from "../components/ActionBar";
import ActivityPanel from "../components/ActivityPanel";

export default function InvoiceReview() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setInvoice(null);
    setError(null);
    getInvoiceById(id)
      .then(setInvoice)
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <>
        <Link to="/queue" className="back-link">
          <ArrowLeft size={14} /> Back to Review Queue
        </Link>
        <p className="text-secondary">{error}</p>
      </>
    );
  }
  if (!invoice) return <p className="text-secondary">Loading…</p>;

  return (
    <>
      <Link to="/queue" className="back-link">
        <ArrowLeft size={14} /> Back to Review Queue
      </Link>

      <div className="invoice-title-block">
        <h1>{invoice.vendor_name}</h1>
        <div className="invoice-meta">
          <span>{invoice.invoice_number}</span>
          <ErpTag erpSource={invoice.erp_source} />
          <span>{invoice.subsidiary}</span>
          <span className="tabular-nums">{formatMoney(invoice.extracted.total_amount, invoice.currency)}</span>
          {invoice.status === "pending" ? (
            <SeverityBadge severity={invoice.severity} />
          ) : (
            <StatusBadge status={invoice.status} />
          )}
        </div>
      </div>

      <div className="split-view">
        <InvoiceDocument invoice={invoice} />
        <div className="review-right">
          <ComparisonPanel invoice={invoice} />
          <ActionBar invoice={invoice} onUpdated={setInvoice} />
          <ActivityPanel invoice={invoice} onUpdated={setInvoice} />
        </div>
      </div>
    </>
  );
}
