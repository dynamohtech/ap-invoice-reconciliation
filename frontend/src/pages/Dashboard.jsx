import { useEffect, useState } from "react";
import StatCard from "../components/StatCard";
import { getDashboardStats } from "../lib/api";
import { ERP_LABEL } from "../lib/status";

export default function Dashboard() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getDashboardStats().then(setStats);
  }, []);

  if (!stats) return <p className="text-secondary">Loading…</p>;

  const bySubsidiary = Object.entries(stats.bySubsidiary).sort((a, b) => b[1] - a[1]);
  const byErp = Object.entries(stats.byErp).sort((a, b) => b[1] - a[1]);
  const maxSub = Math.max(...bySubsidiary.map(([, c]) => c), 1);
  const maxErp = Math.max(...byErp.map(([, c]) => c), 1);

  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      <div className="stat-grid">
        <StatCard primary label="Pending review" value={stats.pending} to="/queue?status=pending" />
        <StatCard label="Approved today" value={stats.approvedToday} to="/queue?status=approved" />
        <StatCard label="Rejected" value={stats.rejected} to="/queue?status=rejected" />
        <StatCard label="Awaiting resend" value={stats.blurry} to="/queue?status=blurry" />
      </div>

      <div className="breakdown">
        <div className="panel">
          <h2>By subsidiary</h2>
          {bySubsidiary.map(([name, count]) => (
            <div className="bar-row" key={name}>
              <span>{name}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(count / maxSub) * 100}%` }} />
              </div>
              <span className="count tabular-nums">{count}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>By ERP source</h2>
          {byErp.map(([erp, count]) => (
            <div className="bar-row" key={erp}>
              <span>{ERP_LABEL[erp] || erp}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(count / maxErp) * 100}%` }} />
              </div>
              <span className="count tabular-nums">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
