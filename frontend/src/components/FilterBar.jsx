export default function FilterBar({ filters, onChange, subsidiaries, resultCount }) {
  function update(key, value) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="filter-bar">
      <select value={filters.subsidiary} onChange={(e) => update("subsidiary", e.target.value)}>
        <option value="">All subsidiaries</option>
        {subsidiaries.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select value={filters.erp_source} onChange={(e) => update("erp_source", e.target.value)}>
        <option value="">All ERPs</option>
        <option value="odoo">Odoo</option>
        <option value="d365">Dynamics 365</option>
      </select>

      <select value={filters.severity} onChange={(e) => update("severity", e.target.value)}>
        <option value="">Any severity</option>
        <option value="mismatch">Mismatch</option>
        <option value="tolerance">Within tolerance</option>
        <option value="match">Matched</option>
      </select>

      <select value={filters.status} onChange={(e) => update("status", e.target.value)}>
        <option value="">All statuses</option>
        <option value="pending">Pending review</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
        <option value="blurry">Unreadable</option>
      </select>

      <input
        type="text"
        placeholder="Search vendor"
        value={filters.vendor}
        onChange={(e) => update("vendor", e.target.value)}
      />

      <span className="filter-count">
        {resultCount} invoice{resultCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
