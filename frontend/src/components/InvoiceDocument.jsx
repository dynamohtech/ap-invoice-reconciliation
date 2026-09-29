import { useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { formatDate } from "../lib/format";

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const STEP = 0.25;

export default function InvoiceDocument({ invoice }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);

  function clamp(s) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  }

  function zoomBy(delta) {
    setScale((s) => {
      const next = clamp(Math.round((s + delta) * 100) / 100);
      if (next === MIN_SCALE) setPos({ x: 0, y: 0 });
      return next;
    });
  }

  function onWheel(e) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? STEP : -STEP);
  }

  function onMouseDown(e) {
    if (scale <= MIN_SCALE) return;
    dragRef.current = { startX: e.clientX - pos.x, startY: e.clientY - pos.y };
    setDragging(true);
  }
  function onMouseMove(e) {
    if (!dragRef.current) return;
    setPos({ x: e.clientX - dragRef.current.startX, y: e.clientY - dragRef.current.startY });
  }
  function endDrag() {
    dragRef.current = null;
    setDragging(false);
  }
  function reset() {
    setScale(1);
    setPos({ x: 0, y: 0 });
  }

  const isBlurry = invoice.status === "blurry";

  return (
    <div className="doc-pane">
      <div className="doc-toolbar">
        <button onClick={() => zoomBy(-STEP)} disabled={scale <= MIN_SCALE} aria-label="Zoom out">
          <ZoomOut size={15} />
        </button>
        <span className="zoom-level tabular-nums">{Math.round(scale * 100)}%</span>
        <button onClick={() => zoomBy(STEP)} disabled={scale >= MAX_SCALE} aria-label="Zoom in">
          <ZoomIn size={15} />
        </button>
        <button onClick={reset} aria-label="Reset zoom">
          <RotateCcw size={13} />
        </button>
      </div>
      <div
        className={`doc-viewport${dragging ? " dragging" : ""}`}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <div
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
            transition: dragging ? "none" : "transform 0.12s ease",
          }}
        >
          {isBlurry ? <BlurrySchematic /> : <InvoiceSchematic invoice={invoice} />}
        </div>
      </div>
      <p className="doc-mock-note">
        {isBlurry
          ? "Auto-flagged unreadable before extraction ran — this stands in for the actual scan."
          : "Schematic reconstruction from extracted data — demo mode has no real invoice image. Point image_url from the API at the real scan to replace this."}
      </p>
    </div>
  );
}

function InvoiceSchematic({ invoice }) {
  const lines = invoice.extracted.line_items;
  const rowH = 22;
  const headerBottom = 160;
  const rowsBottom = headerBottom + Math.max(lines.length, 1) * rowH;
  const totalsY = rowsBottom + 30;
  const height = totalsY + 60;
  const width = 400;
  const ink = "#2a2620";
  const soft = "#6b6355";
  const faint = "#9a927e";
  const rule = "#d8d2c2";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Invoice ${invoice.invoice_number} from ${invoice.vendor_name}`}
    >
      <rect width={width} height={height} fill="#f4f1e9" stroke={rule} />
      <text x="24" y="40" fontFamily="Georgia, serif" fontSize="19" fontWeight="700" fill={ink}>
        INVOICE
      </text>
      <text x="24" y="61" fontFamily="Arial" fontSize="12.5" fill={soft}>
        {invoice.vendor_name}
      </text>
      <text x={width - 24} y="38" textAnchor="end" fontFamily="Arial" fontSize="11" fill={soft}>
        {invoice.invoice_number}
      </text>
      <text x={width - 24} y="54" textAnchor="end" fontFamily="Arial" fontSize="11" fill={soft}>
        {formatDate(invoice.invoice_date)}
      </text>
      {invoice.po_number && (
        <text x={width - 24} y="70" textAnchor="end" fontFamily="Arial" fontSize="11" fill={soft}>
          PO {invoice.po_number}
        </text>
      )}

      <line x1="24" y1="84" x2={width - 24} y2="84" stroke={rule} />
      <text x="24" y="104" fontFamily="Arial" fontSize="9.5" fill={faint}>
        BILL TO
      </text>
      <text x="24" y="120" fontFamily="Arial" fontSize="12" fill={ink}>
        Acme Retail Group — {invoice.subsidiary}
      </text>

      <text x="24" y="148" fontFamily="Arial" fontSize="9.5" fill={faint}>
        DESCRIPTION
      </text>
      <text x={width - 150} y="148" textAnchor="end" fontFamily="Arial" fontSize="9.5" fill={faint}>
        QTY
      </text>
      <text x={width - 80} y="148" textAnchor="end" fontFamily="Arial" fontSize="9.5" fill={faint}>
        UNIT
      </text>
      <text x={width - 24} y="148" textAnchor="end" fontFamily="Arial" fontSize="9.5" fill={faint}>
        TOTAL
      </text>
      <line x1="24" y1={headerBottom - 4} x2={width - 24} y2={headerBottom - 4} stroke={rule} />

      {lines.map((l, i) => {
        const y = headerBottom + (i + 1) * rowH - 6;
        const desc = l.description.length > 30 ? l.description.slice(0, 30) + "…" : l.description;
        return (
          <g key={i}>
            <text x="24" y={y} fontFamily="Arial" fontSize="11" fill={ink}>
              {desc}
            </text>
            <text x={width - 150} y={y} textAnchor="end" fontFamily="Arial" fontSize="11" fill={ink}>
              {l.quantity}
            </text>
            <text x={width - 80} y={y} textAnchor="end" fontFamily="Arial" fontSize="11" fill={ink}>
              {l.unit_price.toLocaleString()}
            </text>
            <text x={width - 24} y={y} textAnchor="end" fontFamily="Arial" fontSize="11" fill={ink}>
              {l.line_total.toLocaleString()}
            </text>
          </g>
        );
      })}

      <line x1={width - 190} y1={totalsY - 18} x2={width - 24} y2={totalsY - 18} stroke={rule} />
      <text x={width - 190} y={totalsY} fontFamily="Arial" fontSize="11" fill={soft}>
        Subtotal
      </text>
      <text x={width - 24} y={totalsY} textAnchor="end" fontFamily="Arial" fontSize="11" fill={ink}>
        {invoice.extracted.subtotal?.toLocaleString() ?? "—"}
      </text>
      <text x={width - 190} y={totalsY + 18} fontFamily="Arial" fontSize="11" fill={soft}>
        VAT (7.5%)
      </text>
      <text x={width - 24} y={totalsY + 18} textAnchor="end" fontFamily="Arial" fontSize="11" fill={ink}>
        {invoice.extracted.tax_amount?.toLocaleString() ?? "—"}
      </text>
      <text
        x={width - 190}
        y={totalsY + 42}
        fontFamily="Georgia, serif"
        fontSize="14"
        fontWeight="700"
        fill={ink}
      >
        Total
      </text>
      <text
        x={width - 24}
        y={totalsY + 42}
        textAnchor="end"
        fontFamily="Georgia, serif"
        fontSize="14"
        fontWeight="700"
        fill={ink}
      >
        {invoice.currency === "NGN" ? "\u20a6" : ""}
        {invoice.extracted.total_amount?.toLocaleString() ?? "—"}
      </text>
    </svg>
  );
}

function BlurrySchematic() {
  return (
    <svg width={360} height={440} viewBox="0 0 360 440" role="img" aria-label="Unreadable scan">
      <rect width="360" height="440" fill="#f4f1e9" stroke="#d8d2c2" />
      <g filter="url(#soften)" opacity="0.85">
        <rect x="24" y="34" width="140" height="16" fill="#c9c2ae" />
        <rect x="24" y="62" width="90" height="9" fill="#d8d2c2" />
        <rect x="250" y="34" width="86" height="9" fill="#d8d2c2" />
        <rect x="250" y="52" width="86" height="9" fill="#d8d2c2" />
        <line x1="24" y1="90" x2="336" y2="90" stroke="#d8d2c2" strokeWidth="2" />
        {Array.from({ length: 9 }).map((_, i) => (
          <rect
            key={i}
            x="24"
            y={130 + i * 26}
            width={300 - (i % 3) * 60}
            height="10"
            fill="#d8d2c2"
          />
        ))}
      </g>
      <defs>
        <filter id="soften">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>
    </svg>
  );
}
