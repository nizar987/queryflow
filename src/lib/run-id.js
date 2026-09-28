// Ids that tie a running query to a later cancel request. The browser makes
// them, so the server only accepts a shape it can safely use as a map key and
// a MongoDB comment.

/** @returns {string} */
export function newRunId() {
  // randomUUID exists only in secure contexts; a page opened over plain http
  // on a LAN address still has getRandomValues.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {unknown} v */
export function isRunId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v);
}
