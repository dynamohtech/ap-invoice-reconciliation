import { useEffect, useState } from "react";
import { ShieldAlert, Lock } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import {
  getAdminUsers,
  updateUserRole,
  getSubsidiaryMap,
  upsertSubsidiaryMap,
} from "../lib/api";
import { ROLE_LABEL, ROLE_IDS, ERP_LABEL } from "../lib/status";

export default function Admin() {
  const { user } = useAuth();
  const canEdit = user.role === "system_admin";

  const [users, setUsers] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [error, setError] = useState(null);
  const [newSubsidiary, setNewSubsidiary] = useState("");

  useEffect(() => {
    getAdminUsers().then(setUsers);
    getSubsidiaryMap().then(setMapping);
  }, []);

  async function changeRole(id, role) {
    setError(null);
    try {
      const updated = await updateUserRole(id, role, user.id);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function changeMapping(subsidiary, erp, confirmed) {
    setError(null);
    try {
      const updated = await upsertSubsidiaryMap(subsidiary, erp, confirmed);
      setMapping((prev) => {
        const exists = prev.some((row) => row.subsidiary === subsidiary);
        return exists
          ? prev.map((row) => (row.subsidiary === subsidiary ? updated : row))
          : [...prev, updated];
      });
    } catch (e) {
      setError(e.message);
    }
  }

  function addSubsidiary(e) {
    e.preventDefault();
    if (!newSubsidiary.trim()) return;
    changeMapping(newSubsidiary.trim(), null, false);
    setNewSubsidiary("");
  }

  if (!users || !mapping) return <p className="text-secondary">Loading…</p>;

  return (
    <>
      <div className="page-header">
        <h1>Admin</h1>
      </div>

      {!canEdit && (
        <p className="confidence-note notice-row">
          <ShieldAlert size={14} /> Viewing as {ROLE_LABEL[user.role]} — read-only. Only a
          System Admin can change roles or the subsidiary/ERP mapping.
        </p>
      )}
      {error && <p className="login-error">{error}</p>}

      <div className="panel">
        <h2>Users &amp; roles</h2>
        <p className="disclosure">
          Segregation of duties: whoever can edit extraction settings, tolerances, or this
          role table should never also approve invoices — that's why an Approver can't reach
          this screen, and why a System Admin can't change their own role below.
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === user.id;
                return (
                  <tr key={u.id}>
                    <td className="vendor">{u.name}</td>
                    <td className="muted">{u.username}</td>
                    <td>
                      <span className="notice-row">
                        {canEdit ? (
                          <select
                            value={u.role}
                            onChange={(e) => changeRole(u.id, e.target.value)}
                            disabled={isSelf}
                            title={isSelf ? "You can't change your own role" : undefined}
                          >
                            {ROLE_IDS.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          ROLE_LABEL[u.role]
                        )}
                        {isSelf && canEdit && <Lock size={12} className="lock-icon" />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>Subsidiary → ERP mapping</h2>
        <p className="disclosure">
          Each invoice routes to exactly one ERP based on
          this mapping — never both. Acme Fresh/Odoo is confirmed; leave everything else "Not
          yet confirmed" until it's actually verified, not guessed. Demo invoice data
          elsewhere in this app shows Acme Stores on the D365 path purely for illustration —
          that's not the same as confirming it here.
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Subsidiary</th>
                <th>ERP</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {mapping.map((row) => (
                <tr key={row.subsidiary}>
                  <td className="vendor">{row.subsidiary}</td>
                  <td>
                    {canEdit ? (
                      <select
                        value={row.erp ?? ""}
                        onChange={(e) =>
                          changeMapping(row.subsidiary, e.target.value || null, !!e.target.value)
                        }
                      >
                        <option value="">Not yet confirmed</option>
                        <option value="odoo">Odoo</option>
                        <option value="d365">Dynamics 365</option>
                      </select>
                    ) : row.erp ? (
                      ERP_LABEL[row.erp]
                    ) : (
                      "Not yet confirmed"
                    )}
                  </td>
                  <td>
                    <span className={`badge ${row.confirmed ? "match" : "neutral"}`}>
                      {row.confirmed ? "Confirmed" : "Unconfirmed"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <form className="add-subsidiary-form" onSubmit={addSubsidiary}>
            <input
              type="text"
              placeholder="Add a subsidiary not listed above…"
              value={newSubsidiary}
              onChange={(e) => setNewSubsidiary(e.target.value)}
            />
            <button className="btn btn-ghost" type="submit" disabled={!newSubsidiary.trim()}>
              Add
            </button>
          </form>
        )}
      </div>
    </>
  );
}
