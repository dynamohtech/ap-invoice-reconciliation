import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { addComment } from "../lib/api";
import { formatDateTime, initials } from "../lib/format";

export default function ActivityPanel({ invoice, onUpdated }) {
  const { user, canComment } = useAuth();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      onUpdated(await addComment(invoice.id, note.trim(), user));
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Activity</h2>
      <div className="activity-list">
        {invoice.activity.map((a) => (
          <div className={`activity-item activity-${a.type}`} key={a.id}>
            <div className="activity-avatar">{a.type === "system" ? "—" : initials(a.author)}</div>
            <div className="activity-body">
              <div className="activity-head">
                <span className="activity-author">{a.author}</span>
                <span className="activity-time">{formatDateTime(a.timestamp)}</span>
              </div>
              <p className="activity-note">{a.note}</p>
            </div>
          </div>
        ))}
      </div>
      {canComment && (
        <form className="comment-form" onSubmit={submit}>
          <textarea
            rows={1}
            placeholder="Add a comment..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn btn-ghost" type="submit" disabled={busy || !note.trim()}>
            Post
          </button>
        </form>
      )}
    </div>
  );
}
