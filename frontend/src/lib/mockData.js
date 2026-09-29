// ---------------------------------------------------------------------
// Synthetic data only. Vendor names, PO numbers, and figures below are
// invented for UI testing — none of this is real vendor data.
//
// Subsidiary -> ERP mapping used here: Acme Fresh -> Odoo (Path A) and
// Acme Stores -> D365 (Path B), so the UI can show both reconciliation
// paths. The Admin screen's subsidiary mapping is the source of truth
// in a real deployment.
// ---------------------------------------------------------------------

function daysAgo(days, hour = 9, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function line(description, quantity, unit_price, product_code = null) {
  return {
    description,
    product_code,
    quantity,
    unit_price,
    line_total: Math.round(quantity * unit_price * 100) / 100,
  };
}

const RAW_INVOICES = [
  {
    id: "inv_001",
    invoice_number: "INV-2026-3381",
    vendor_name: "Delta Meats Supply Co.",
    subsidiary: "Acme Fresh",
    erp_source: "odoo",
    po_number: "PO-AF-2281",
    invoice_date_offset: 2,
    submitted_offset: 2,
    status: "pending",
    extractedLines: [
      line("Beef carcass, grade A", 380, 4150, "BF-CARC-A"),
      line("Chicken, whole dressed", 210, 2650, "CHK-WD-01"),
    ],
    erpLines: [
      line("Beef carcass, grade A", 380, 4150, "BF-CARC-A"),
      line("Chicken, whole dressed", 210, 2650, "CHK-WD-01"),
    ],
    confidence_notes: "",
  },
  {
    id: "inv_002",
    invoice_number: "INV-2026-3390",
    vendor_name: "Northgate Livestock Distributors Ltd",
    subsidiary: "Acme Fresh",
    erp_source: "odoo",
    po_number: "PO-AF-2299",
    invoice_date_offset: 4,
    submitted_offset: 4,
    status: "pending",
    extractedLines: [
      line("Goat meat, bone-in", 150, 3900, "GT-BI-02"),
      line("Packaging crates", 40, 2500, "PKG-CR-40"),
    ],
    erpLines: [
      line("Goat meat, bone-in", 150, 3880, "GT-BI-02"),
      line("Packaging crates", 40, 2500, "PKG-CR-40"),
    ],
    confidence_notes: "",
  },
  {
    id: "inv_003",
    invoice_number: "INV-2026-3352",
    vendor_name: "Yaba Packaging Nig. Ltd",
    subsidiary: "Acme Fresh",
    erp_source: "odoo",
    po_number: null,
    invoice_date_offset: 13,
    submitted_offset: 13,
    status: "pending",
    extractedLines: [
      line("Vacuum-seal packaging rolls", 60, 8200, "VSP-ROLL"),
      line("Label rolls, thermal", 25, 3100, "LBL-TH-25"),
    ],
    erpLines: [
      line("Vacuum-seal packaging rolls", 60, 7600, "VSP-ROLL"),
      line("Label rolls, thermal", 25, 3100, "LBL-TH-25"),
    ],
    confidence_notes:
      "PO number not printed on this invoice — matched to Odoo bill by vendor name and date window instead.",
    activityExtra: [
      {
        type: "comment",
        author: "Dana R.",
        role: "reviewer",
        offset: 11,
        note: "Vendor confirmed by phone this was a one-off price increase, not yet reflected in our PO. Flagging for approver.",
      },
    ],
  },
  {
    id: "inv_004",
    invoice_number: "INV-2026-3398",
    vendor_name: "Emeka & Sons Trading Co.",
    subsidiary: "Acme Fresh",
    erp_source: "odoo",
    po_number: "PO-AF-2305",
    invoice_date_offset: 1,
    submitted_offset: 1,
    status: "approved",
    resolvedOffset: 0,
    resolvedBy: "Jordan A.",
    extractedLines: [line("Spice mix, house blend", 30, 5400, "SPC-HB-30")],
    erpLines: [line("Spice mix, house blend", 30, 5400, "SPC-HB-30")],
    confidence_notes: "",
  },
  {
    id: "inv_005",
    invoice_number: "INV-2026-3301",
    vendor_name: "Delta Meats Supply Co.",
    subsidiary: "Acme Fresh",
    erp_source: "odoo",
    po_number: "PO-AF-2266",
    invoice_date_offset: 6,
    submitted_offset: 6,
    status: "rejected",
    resolvedOffset: 5,
    resolvedBy: "Jordan A.",
    rejectReason: "Duplicate submission",
    rejectNote:
      "Already reconciled under INV-2026-3244 last week. Asked the store to confirm before resending.",
    extractedLines: [line("Beef carcass, grade A", 300, 4150, "BF-CARC-A")],
    erpLines: [],
    noMatchDescriptions: ["Beef carcass, grade A"],
    confidence_notes: "",
  },
  {
    id: "inv_006",
    invoice_number: "AS-INV-9021",
    vendor_name: "Coastal Beverages Plc",
    subsidiary: "Acme Stores",
    erp_source: "d365",
    po_number: "PO-AS-4410",
    invoice_date_offset: 3,
    submitted_offset: 3,
    status: "pending",
    extractedLines: [
      line("Bottled water 60cl, carton", 200, 1850, "BW-60-CTN"),
      line("Malt drink 33cl, carton", 150, 2400, "MD-33-CTN"),
    ],
    erpLines: [
      line("Bottled water 60cl, carton", 200, 1850, "BW-60-CTN"),
      line("Malt drink 33cl, carton", 150, 2400, "MD-33-CTN"),
    ],
    confidence_notes: "",
  },
  {
    id: "inv_007",
    invoice_number: "AS-INV-9034",
    vendor_name: "Highland Dairy Nigeria Ltd",
    subsidiary: "Acme Stores",
    erp_source: "d365",
    po_number: "PO-AS-4425",
    invoice_date_offset: 8,
    submitted_offset: 8,
    status: "pending",
    extractedLines: [line("UHT milk 1L, carton", 500, 1650, "UHT-1L-CTN")],
    erpLines: [line("UHT milk 1L, carton", 460, 1650, "UHT-1L-CTN")],
    confidence_notes: "",
    activityExtra: [
      {
        type: "comment",
        author: "Taylor B.",
        role: "reviewer",
        offset: 6,
        note: "Receipt shows a partial delivery — 40 cartons short. Checking with the warehouse before this goes further.",
      },
    ],
  },
  {
    id: "inv_008",
    invoice_number: "AS-INV-9040",
    vendor_name: "Ilesha Fresh Produce Ltd",
    subsidiary: "Acme Stores",
    erp_source: "d365",
    po_number: "PO-AS-4432",
    invoice_date_offset: 5,
    submitted_offset: 5,
    status: "approved",
    resolvedOffset: 1,
    resolvedBy: "Riley K.",
    extractedLines: [line("Tomatoes, crate", 80, 3200, "TOM-CRT-80")],
    erpLines: [line("Tomatoes, crate", 80, 3180, "TOM-CRT-80")],
    confidence_notes: "",
  },
  {
    id: "inv_009",
    invoice_number: "AS-INV-9052",
    vendor_name: "Adaeze Foods Ltd",
    subsidiary: "Acme Stores",
    erp_source: "d365",
    po_number: null,
    invoice_date_offset: 5,
    submitted_offset: 5,
    status: "blurry",
    extractedLines: [],
    erpLines: [],
    confidence_notes: "",
  },
  {
    id: "inv_010",
    invoice_number: "INV-2026-3405",
    vendor_name: "Northgate Livestock Distributors Ltd",
    subsidiary: "Acme Fresh",
    erp_source: "odoo",
    po_number: null,
    invoice_date_offset: 2,
    submitted_offset: 2,
    status: "blurry",
    extractedLines: [],
    erpLines: [],
    confidence_notes: "",
  },
  {
    id: "inv_011",
    invoice_number: "INV-2026-3298",
    vendor_name: "Yaba Packaging Nig. Ltd",
    subsidiary: "Acme Fresh",
    erp_source: "odoo",
    po_number: "PO-AF-2244",
    invoice_date_offset: 15,
    submitted_offset: 15,
    status: "pending",
    extractedLines: [line("Cling film rolls", 100, 1900, "CF-ROLL-1900")],
    erpLines: [line("Cling film rolls", 100, 1700, "CF-ROLL-1900")],
    confidence_notes: "",
  },
  {
    id: "inv_012",
    invoice_number: "AS-INV-8988",
    vendor_name: "Coastal Beverages Plc",
    subsidiary: "Acme Stores",
    erp_source: "d365",
    po_number: null,
    invoice_date_offset: 9,
    submitted_offset: 9,
    status: "rejected",
    resolvedOffset: 7,
    resolvedBy: "Riley K.",
    rejectReason: "Pricing discrepancy escalated to vendor",
    rejectNote:
      "Both quantity and unit price are off from the receipt. Asked the vendor to resend a corrected invoice rather than approve with a large adjustment.",
    extractedLines: [line("Malt drink 33cl, carton", 180, 2600, "MD-33-CTN")],
    erpLines: [line("Malt drink 33cl, carton", 150, 2400, "MD-33-CTN")],
    confidence_notes: "",
  },
];

const TOLERANCE = 0.01; // 1% — matches the default `tolerance` used by the comparison functions

function sum(lines, key) {
  return Math.round(lines.reduce((t, l) => t + l[key === "amount" ? "line_total" : key], 0) * 100) / 100;
}

function fieldSeverity(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return "mismatch";
  if (a === b) return "match";
  const diff = Math.abs(a - b);
  const base = Math.max(Math.abs(b), 1);
  return diff / base <= TOLERANCE ? "tolerance" : "mismatch";
}

function buildLineComparison(extractedLines, erpLines) {
  return extractedLines.map((inv) => {
    const match = erpLines.find((e) => e.description === inv.description);
    if (!match) {
      return {
        description: inv.description,
        product_code: inv.product_code,
        invoice: inv,
        erp: null,
        status: "mismatch",
        note: `No matching ${erpLines === null ? "record" : "line"} found`,
      };
    }
    const qtyStatus = fieldSeverity(inv.quantity, match.quantity);
    const priceStatus = fieldSeverity(inv.unit_price, match.unit_price);
    const status = qtyStatus === "mismatch" || priceStatus === "mismatch"
      ? "mismatch"
      : qtyStatus === "tolerance" || priceStatus === "tolerance"
      ? "tolerance"
      : "match";
    return {
      description: inv.description,
      product_code: inv.product_code,
      invoice: inv,
      erp: match,
      status,
      qtyStatus,
      priceStatus,
    };
  });
}

function buildInvoice(raw) {
  const extractedSubtotal = sum(raw.extractedLines, "amount");
  const extractedTax = Math.round(extractedSubtotal * 0.075 * 100) / 100;
  const extractedTotal = Math.round((extractedSubtotal + extractedTax) * 100) / 100;

  const erpSubtotal = raw.erpLines.length ? sum(raw.erpLines, "amount") : null;
  const erpTax = erpSubtotal !== null ? Math.round(erpSubtotal * 0.075 * 100) / 100 : null;
  const erpTotal = erpSubtotal !== null ? Math.round((erpSubtotal + erpTax) * 100) / 100 : null;

  const lineComparison =
    raw.status === "blurry" ? [] : buildLineComparison(raw.extractedLines, raw.erpLines);

  const fieldStatus =
    raw.status === "blurry"
      ? {}
      : {
          subtotal: fieldSeverity(extractedSubtotal, erpSubtotal),
          tax_amount: fieldSeverity(extractedTax, erpTax),
          total_amount: fieldSeverity(extractedTotal, erpTotal),
        };

  const severities =
    raw.status === "blurry"
      ? []
      : [
          fieldStatus.subtotal,
          fieldStatus.tax_amount,
          fieldStatus.total_amount,
          ...lineComparison.map((l) => l.status),
        ];
  const severity =
    raw.status === "blurry"
      ? null
      : severities.includes("mismatch")
      ? "mismatch"
      : severities.includes("tolerance")
      ? "tolerance"
      : "match";

  const discrepancies = [];
  if (raw.status !== "blurry") {
    const recordWord = raw.erp_source === "odoo" ? "bill" : "receipt";
    lineComparison.forEach((l) => {
      if (!l.erp) {
        discrepancies.push(`No matching ${recordWord} line for: ${l.description}`);
        return;
      }
      if (l.qtyStatus === "mismatch") {
        discrepancies.push(
          `Quantity mismatch on ${l.description}: invoice=${l.invoice.quantity}, ${recordWord}=${l.erp.quantity}`
        );
      }
      if (l.priceStatus === "mismatch") {
        discrepancies.push(
          `Price mismatch on ${l.description}: invoice=${l.invoice.unit_price.toFixed(2)}, ${recordWord}=${l.erp.unit_price.toFixed(2)}`
        );
      }
    });
    if (fieldStatus.total_amount === "mismatch") {
      discrepancies.push(
        `Total mismatch: invoice=${extractedTotal.toFixed(2)}, ${raw.erp_source === "odoo" ? "Odoo bill" : "D365 receipt"}=${erpTotal !== null ? erpTotal.toFixed(2) : "n/a"}`
      );
    }
  }

  const activity = [
    {
      id: `${raw.id}_act_intake`,
      type: "system",
      author: "System",
      role: "system",
      timestamp: daysAgo(raw.submitted_offset, 8, 5),
      note:
        raw.status === "blurry"
          ? "Invoice received. Flagged unreadable before extraction — resend requested from sender automatically."
          : "Invoice received and queued for extraction.",
    },
  ];

  (raw.activityExtra || []).forEach((a, i) => {
    activity.push({
      id: `${raw.id}_act_extra_${i}`,
      type: a.type,
      author: a.author,
      role: a.role,
      timestamp: daysAgo(a.offset),
      note: a.note,
    });
  });

  if (raw.status === "approved") {
    activity.push({
      id: `${raw.id}_act_resolved`,
      type: "approved",
      author: raw.resolvedBy,
      role: "approver",
      timestamp: daysAgo(raw.resolvedOffset, 14, 20),
      note: "Approved. No mismatch outside tolerance.",
    });
  } else if (raw.status === "rejected") {
    activity.push({
      id: `${raw.id}_act_resolved`,
      type: "rejected",
      author: raw.resolvedBy,
      role: "approver",
      timestamp: daysAgo(raw.resolvedOffset, 11, 40),
      note: `${raw.rejectReason}. ${raw.rejectNote || ""}`.trim(),
    });
  }

  return {
    id: raw.id,
    invoice_number: raw.invoice_number,
    vendor_name: raw.vendor_name,
    subsidiary: raw.subsidiary,
    erp_source: raw.erp_source,
    currency: "NGN",
    invoice_date: daysAgo(raw.invoice_date_offset).slice(0, 10),
    due_date: daysAgo(raw.invoice_date_offset - 30).slice(0, 10),
    po_number: raw.po_number,
    submitted_at: daysAgo(raw.submitted_offset, 8, 5),
    status: raw.status,
    severity,
    extracted: {
      subtotal: raw.status === "blurry" ? null : extractedSubtotal,
      tax_amount: raw.status === "blurry" ? null : extractedTax,
      total_amount: raw.status === "blurry" ? null : extractedTotal,
      line_items: raw.extractedLines,
      confidence_notes: raw.confidence_notes || "",
    },
    erpRecord: {
      label: raw.erp_source === "odoo" ? "Odoo bill" : "D365 Product Receipt",
      reference:
        raw.erpLines.length || raw.status === "approved"
          ? raw.erp_source === "odoo"
            ? `BILL/2026/${1000 + Number(raw.id.split("_")[1])}`
            : `PR-${88000 + Number(raw.id.split("_")[1])}`
          : null,
      subtotal: erpSubtotal,
      tax_amount: erpTax,
      total_amount: erpTotal,
      line_items: raw.erpLines,
    },
    fieldStatus,
    lineComparison,
    discrepancies,
    activity,
  };
}

export const MOCK_INVOICES = RAW_INVOICES.map(buildInvoice);

export function getMockInvoice(id) {
  return MOCK_INVOICES.find((inv) => inv.id === id) || null;
}

// ---------------------------------------------------------------------
// Shared read/write helpers. Both src/lib/api.js (frontend's in-memory
// mock mode) and reference-server/server.js (a real HTTP process) import
// these, so there's exactly one implementation of "what a request against
// this contract returns" instead of two copies drifting apart.
// ---------------------------------------------------------------------

export function computeStats(invoices) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const approvedToday = invoices.filter((i) => {
    if (i.status !== "approved") return false;
    const entry = [...i.activity].reverse().find((a) => a.type === "approved");
    return entry && new Date(entry.timestamp) >= today;
  }).length;

  const bySubsidiary = {};
  const byErp = {};
  invoices.forEach((i) => {
    bySubsidiary[i.subsidiary] = (bySubsidiary[i.subsidiary] || 0) + 1;
    byErp[i.erp_source] = (byErp[i.erp_source] || 0) + 1;
  });

  return {
    pending: invoices.filter((i) => i.status === "pending").length,
    approvedToday,
    rejected: invoices.filter((i) => i.status === "rejected").length,
    blurry: invoices.filter((i) => i.status === "blurry").length,
    total: invoices.length,
    bySubsidiary,
    byErp,
  };
}

export function filterInvoices(invoices, filters = {}) {
  return invoices
    .filter((i) => {
      if (filters.subsidiary && i.subsidiary !== filters.subsidiary) return false;
      if (filters.erp_source && i.erp_source !== filters.erp_source) return false;
      if (filters.severity && i.severity !== filters.severity) return false;
      if (filters.status && i.status !== filters.status) return false;
      if (filters.vendor && !i.vendor_name.toLowerCase().includes(filters.vendor.toLowerCase())) {
        return false;
      }
      return true;
    })
    .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
}

export function getFilterOptionsData() {
  return { subsidiaries: [...new Set(MOCK_INVOICES.map((i) => i.subsidiary))] };
}

function pushActivity(inv, type, note, actor) {
  inv.activity.push({
    id: `${inv.id}_act_${inv.activity.length}`,
    type,
    author: actor?.name || "Unknown",
    role: actor?.role || "unknown",
    timestamp: new Date().toISOString(),
    note,
  });
  return inv;
}

export function approveInMemory(id, { comment, actor } = {}) {
  const inv = getMockInvoice(id);
  if (!inv) return null;
  inv.status = "approved";
  return pushActivity(inv, "approved", comment || "Approved — no mismatch outside tolerance.", actor);
}

export function rejectInMemory(id, { reason, comment, actor } = {}) {
  const inv = getMockInvoice(id);
  if (!inv) return null;
  if (!reason) throw new Error("A rejection reason is required.");
  inv.status = "rejected";
  return pushActivity(inv, "rejected", `${reason}${comment ? ". " + comment : ""}`, actor);
}

export function requestInfoInMemory(id, { comment, actor } = {}) {
  const inv = getMockInvoice(id);
  if (!inv) return null;
  return pushActivity(inv, "requested_info", comment || "More information requested.", actor);
}

export function addCommentInMemory(id, note, actor) {
  const inv = getMockInvoice(id);
  if (!inv) return null;
  return pushActivity(inv, "comment", note, actor);
}
