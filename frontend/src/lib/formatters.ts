// formatters.ts
// Centralized number and date formatting helpers used across all pages.

/** Format ISK with thousands separators. Large values get B/M abbreviations. */
export function fmtIsk(n: number | null | undefined): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000_000) {
    return (n / 1_000_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'B';
  }
  if (Math.abs(n) >= 1_000_000) {
    return (n / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'M';
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Format a percentage value with one decimal place. */
export function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
}

/** Format a plain number with thousands separators, no decimals. */
export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Format an ISO date string to a short readable format. */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
