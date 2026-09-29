import { useState } from "react";
import { Check, X, MessageCircleQuestion } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { approveInvoice, rejectInvoice, requestMoreInfo } from "../lib/api";

const REJECT_REASONS = [
  "Price mismatch confirmed",
  "Quantity mismatch confirmed",
  "Duplicate submission",
  "No matching PO, bill, or receipt",
  "Other — see comment",
];

export default function ActionBar({ invoice, onUpdated }) {
  const { user, canApprove } = useAuth();
  const [modal, setModal] = useState(null); // 'reject' | 'info' | null
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  if (invoice.status === "blurry") {
    return (
      <div className="action-bar">
        <p className="disclosure">
          Auto-flagged unreadable before extraction ran — a resend request already went to whoever
          sent it. It re-enters this queue once a clearer copy arrives, nothing to act on yet.
        </p>
      </div>
    );
  }

  const resolved = invoice.status === "approved" || invoice.status === "rejected";

  async function doApprove() {
    setBusy(true);
    try {
      onUpdated(await approveInvoice(invoice.id, { actor: user }));
    } finally {
      setBusy(false);
    }
  }

  async function submitReject() {
    setBusy(true);
    try {
      onUpdated(await rejectInvoice(invoice.id, { reason, comment, actor: user }));
      setModal(null);
      setComment("");
    } finally {
      setBusy(false);
    }
  }

  async function submitInfo() {
    setBusy(true);
    try {
      onUpdated(await requestMoreInfo(invoice.id, { comment, actor: user }));
      setModal(null);
      setComment("");
    } finally {
      setBusy(false);
    }
  }

  if (resolved) {
    const isApproved = invoice.status === "approved";
    return (
      <div className="action-bar">
        <div className="status-resolved">
          {isApproved ? <Check size={16} color="var(--match)" /> : <X size={16} color="var(--mismatch)" />}
          This invoice was {isApproved ? "approved" : "rejected"} — see activity below for who and why.
        </div>
      </div>
    );
  }

  return (
    <div className="action-bar">
      <div className="buttons">
        <button className="btn btn-primary" onClick={doApprove} disabled={!canApprove || busy}>
          <Check size={15} /> Approve
        </button>
        <button className="btn btn-danger" onClick={() => setModal("reject")} disabled={!canApprove || busy}>
          <X size={15} /> Reject
        </button>
        <button className="btn btn-ghost" onClick={() => setModal("info")} disabled={busy}>
          <MessageCircleQuestion size={15} /> Request more info
        </button>
      </div>
      <p className="disclosure">
        {canApprove
          ? "Approving or rejecting only updates this reconciliation record — nothing posts to Odoo or D365, and no payment is triggered."
          : `Signed in as ${user.roleLabel}. Only an Approver can approve or reject — switch role above to try it.`}
      </p>

      {modal === "reject" && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Reject invoice</h3>
            <p className="hint">A reason is required — it's logged in the audit trail and shared with the store.</p>
            <label htmlFor="reject-reason">Reason</label>
            <select id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REJECT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <label htmlFor="reject-comment">Comment (optional)</label>
            <textarea
              id="reject-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add context for whoever follows up..."
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={submitReject} disabled={busy}>
                Reject invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "info" && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Request more info</h3>
            <p className="hint">Logs a note on this invoice without approving or rejecting it.</p>
            <label htmlFor="info-comment">What do you need?</label>
            <textarea
              id="info-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g. Ask the store to confirm delivered quantity..."
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitInfo} disabled={busy || !comment.trim()}>
                Send request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
