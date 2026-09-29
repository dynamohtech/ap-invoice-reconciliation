// ---------------------------------------------------------------------
// Pure aggregate computations over the invoice list, for the Reports
// screen. No mutation, no fetching — plain functions of `invoices`, so
// both the frontend's mock mode and reference-server can call the same
// code on the same data (same "one source of truth" shape as
// computeStats() in mockData.js). No imports needed here on purpose —
// nothing for a Node vs. Vite extension mismatch to hide in.
// ---------------------------------------------------------------------

// An invoice only has a discrepancy verdict once extraction + matching
// actually ran — blurry ones never got that far.
function wasCompared(inv) {
  return inv.status !== "blurry" && inv.severity != null;
}

function groupCount(invoices, keyFn) {
  const map = new Map();
  invoices.forEach((inv) => {
    const key = keyFn(inv);
    if (key == null) return;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

function discrepancyRatesBy(invoices, keyFn) {
  const totals = groupCount(invoices.filter(wasCompared), keyFn);
  const mismatches = groupCount(
    invoices.filter((inv) => wasCompared(inv) && inv.severity === "mismatch"),
    keyFn
  );
  return [...totals.entries()]
    .map(([key, total]) => {
      const mismatchCount = mismatches.get(key) || 0;
      return { key, total, mismatches: mismatchCount, rate: mismatchCount / total };
    })
    .sort((a, b) => b.rate - a.rate);
}

function findResolvedTimestamp(inv) {
  const entry = [...inv.activity].reverse().find((a) => a.type === "approved" || a.type === "rejected");
  return entry ? new Date(entry.timestamp).getTime() : null;
}

export function computeResolutionTime(invoices) {
  const resolved = invoices
    .map((inv) => {
      const resolvedAt = findResolvedTimestamp(inv);
      if (!resolvedAt) return null;
      const submittedAt = new Date(inv.submitted_at).getTime();
      return { subsidiary: inv.subsidiary, days: Math.max((resolvedAt - submittedAt) / 86400000, 0) };
    })
    .filter(Boolean);

  const overallDays = resolved.length
    ? resolved.reduce((sum, r) => sum + r.days, 0) / resolved.length
    : null;

  const bySubMap = new Map();
  resolved.forEach((r) => {
    const list = bySubMap.get(r.subsidiary) || [];
    list.push(r.days);
    bySubMap.set(r.subsidiary, list);
  });

  const bySubsidiary = [...bySubMap.entries()]
    .map(([subsidiary, days]) => ({
      subsidiary,
      avgDays: days.reduce((a, b) => a + b, 0) / days.length,
      count: days.length,
    }))
    .sort((a, b) => b.avgDays - a.avgDays);

  return { overallDays, count: resolved.length, bySubsidiary };
}

export function computeResendFrequency(invoices) {
  // "Sender" is read as the vendor on the invoice — see the note on the
  // Reports screen itself for why, and what would need to change once
  // the real intake channel exists.
  const counts = groupCount(
    invoices.filter((inv) => inv.status === "blurry"),
    (inv) => inv.vendor_name
  );
  return [...counts.entries()]
    .map(([vendor, count]) => ({ vendor, count }))
    .sort((a, b) => b.count - a.count);
}

export function computeReportsSummary(invoices) {
  return {
    discrepancyByVendor: discrepancyRatesBy(invoices, (inv) => inv.vendor_name).map(
      ({ key, ...rest }) => ({ vendor: key, ...rest })
    ),
    discrepancyBySubsidiary: discrepancyRatesBy(invoices, (inv) => inv.subsidiary).map(
      ({ key, ...rest }) => ({ subsidiary: key, ...rest })
    ),
    resolutionTime: computeResolutionTime(invoices),
    resendFrequency: computeResendFrequency(invoices),
  };
}
