import { useEffect, useState } from "react";
import { getReportsSummary } from "../lib/api";
import { formatPercent, formatDuration } from "../lib/format";

export default function Reports() {
  const [data, setData] = useState(null);

  useEffect(() => {
    getReportsSummary().then(setData);
  }, []);

  if (!data) return <p className="text-secondary">Loading…</p>;

  const maxResend = Math.max(1, ...data.resendFrequency.map((r) => r.count));
  const maxResDays = Math.max(1, ...data.resolutionTime.bySubsidiary.map((r) => r.avgDays));

  return (
    <>
      <div className="page-header">
        <h1>Reports</h1>
      </div>

      <div className="panel metric-panel">
        <span className="metric-value tabular-nums">
          {formatDuration(data.resolutionTime.overallDays)}
        </span>
        <span className="metric-label">
          Average time to a decision, across {data.resolutionTime.count} resolved invoice
          {data.resolutionTime.count === 1 ? "" : "s"}
        </span>
      </div>

      <div className="breakdown">
        <div className="panel">
          <h2>Discrepancy rate by vendor</h2>
          {data.discrepancyByVendor.length === 0 ? (
            <p className="text-secondary">No compared invoices yet.</p>
          ) : (
            data.discrepancyByVendor.map((row) => (
              <div className="bar-row wide-label" key={row.vendor}>
                <span title={row.vendor}>{row.vendor}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${row.rate * 100}%` }} />
                </div>
                <span className="count tabular-nums">{formatPercent(row.rate)}</span>
              </div>
            ))
          )}
        </div>
        <div className="panel">
          <h2>Discrepancy rate by subsidiary</h2>
          {data.discrepancyBySubsidiary.map((row) => (
            <div className="bar-row" key={row.subsidiary}>
              <span>{row.subsidiary}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${row.rate * 100}%` }} />
              </div>
              <span className="count tabular-nums">{formatPercent(row.rate)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="breakdown">
        <div className="panel">
          <h2>Resend frequency (unreadable scans)</h2>
          {data.resendFrequency.length === 0 ? (
            <p className="text-secondary">No resend requests yet.</p>
          ) : (
            data.resendFrequency.map((row) => (
              <div className="bar-row wide-label" key={row.vendor}>
                <span title={row.vendor}>{row.vendor}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${(row.count / maxResend) * 100}%` }}
                  />
                </div>
                <span className="count tabular-nums">{row.count}</span>
              </div>
            ))
          )}
        </div>
        <div className="panel">
          <h2>Resolution time by subsidiary</h2>
          {data.resolutionTime.bySubsidiary.map((row) => (
            <div className="bar-row" key={row.subsidiary}>
              <span>{row.subsidiary}</span>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${(row.avgDays / maxResDays) * 100}%` }}
                />
              </div>
              <span className="count tabular-nums">{formatDuration(row.avgDays)}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="confidence-note">
        "Sender" above is read as the vendor on the invoice, since that's what the extracted
        data actually carries — it isn't settled yet whether a store or the
        vendor itself is who gets asked to resend a blurry scan. Worth revisiting once the
        real intake channel is built and that's no longer ambiguous.
      </p>
    </>
  );
}
