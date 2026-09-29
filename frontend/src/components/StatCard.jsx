import { Link } from "react-router-dom";

export default function StatCard({ label, value, to, primary = false }) {
  return (
    <Link to={to} className={`stat-card${primary ? " primary" : ""}`}>
      <span className="value tabular-nums">{value}</span>
      <span className="label">{label}</span>
    </Link>
  );
}
