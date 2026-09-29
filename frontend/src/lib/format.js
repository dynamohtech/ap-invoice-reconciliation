const currencyFormatters = {};

export function formatMoney(amount, currency = "NGN") {
  if (amount === null || amount === undefined) return "—";
  if (!currencyFormatters[currency]) {
    currencyFormatters[currency] = new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return currencyFormatters[currency].format(amount);
}

export function formatDate(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(isoDate) {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function ageInDays(isoDate) {
  if (!isoDate) return null;
  const submitted = new Date(isoDate).getTime();
  if (Number.isNaN(submitted)) return null;
  const days = Math.floor((Date.now() - submitted) / (1000 * 60 * 60 * 24));
  return Math.max(days, 0);
}

export function formatAge(isoDate) {
  const days = ageInDays(isoDate);
  if (days === null) return "—";
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function initials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

export function formatPercent(rate, digits = 0) {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

export function formatDuration(days) {
  if (days === null || days === undefined || Number.isNaN(days)) return "—";
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} hr${hours === 1 ? "" : "s"}`;
  }
  return `${days.toFixed(1)} days`;
}
