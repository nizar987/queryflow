// Human-readable elapsed time for the query timer.
//
// The number changes ten times a second while a query runs, so it has to stay
// short and must not jump between units mid-count: sub-second in ms, then
// seconds with one decimal (floored, so it never shows "60,0 dtk"), then
// minutes and hours with zero-padded fields that keep the width steady.

const pad = (n) => String(n).padStart(2, '0');

/** `842 ms` · `12,3 dtk` · `1m 05d` · `1j 02m 05d` */
export function formatElapsed(ms) {
  const v = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (v < 1000) return `${Math.round(v)} ms`;
  if (v < 60_000) return `${(Math.floor(v / 100) / 10).toFixed(1).replace('.', ',')} dtk`;

  const total = Math.floor(v / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}j ${pad(m)}m ${pad(s)}d` : `${m}m ${pad(s)}d`;
}
