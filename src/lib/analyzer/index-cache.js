// Remembers the last index check per connection + table set.
//
// This lives in its own module on purpose: code inside a Svelte `<script>`
// block runs once per component instance, and the Optimize panel is re-created
// on every Analisa run — a cache declared there would be thrown away exactly
// when it is needed. Module state outlives the component.

const CACHE = new Map();

/** Indexes change rarely, but not never; an hour-old answer is not "current". */
export const TTL_MS = 5 * 60 * 1000;

export function cacheKey(connectionId, tables) {
  if (!connectionId || !tables || tables.length === 0) return '';
  return `${connectionId}|${[...tables].join(',')}`;
}

/** @returns {object|null} the stored entry, or null when absent or expired. */
export function getCached(key, now = Date.now()) {
  if (!key) return null;
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (now - hit.at >= TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit;
}

export function putCached(key, entry) {
  if (!key) return entry;
  CACHE.set(key, entry);
  return entry;
}

export function dropCached(key) {
  CACHE.delete(key);
}

/** Test seam — nothing in the app clears the whole cache. */
export function clearCache() {
  CACHE.clear();
}
