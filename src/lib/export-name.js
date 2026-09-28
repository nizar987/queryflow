// Filenames for downloads the user can rename.
//
// The default mirrors the server's `filename()` in server/csv.js (slug + time
// stamp, so exports sort by when they were taken), but uses local time: this
// one is shown to the person typing, and a UTC stamp reads as the wrong hour.
//
// Whatever is typed goes into an <a download> attribute, never a path or a
// header, but it still ends up as a file on the user's disk — so separators,
// Windows-reserved characters and control characters are removed here.

const MAX_BASE = 120;
const pad = (n) => String(n).padStart(2, '0');

function stamp(d) {
  return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate()),
    pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join('-');
}

/** `Prod_DB-query-2026-09-26-09-05-07` — no extension; the dialog shows it separately. */
export function defaultExportName(parts, date = new Date()) {
  const slug = parts
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80);
  return `${slug || 'queryflow'}-${stamp(date)}`;
}

/**
 * Turn what the user typed into a safe filename ending in `.${ext}`.
 * @returns {string | null} null when nothing usable is left — the caller falls back to the default.
 */
export function sanitizeExportName(input, ext) {
  const suffix = new RegExp(`\\.${ext}$`, 'i');
  const base = String(input ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*/\\]+/g, '_')
    .trim()
    .replace(suffix, '')
    .replace(/^[\s._-]+/, '')
    .slice(0, MAX_BASE)
    .replace(/[\s.]+$/, '');
  return base ? `${base}.${ext}` : null;
}
