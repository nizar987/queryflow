// Passing a query between the Visualizer and the Query tab. sessionStorage,
// not a URL param: queries can be long and can contain internal identifiers
// that have no business sitting in browser history.
const KEY = 'qf_handoff';

export function stash(query, dialect) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ query, dialect }));
  } catch (e) {
    /* storage disabled — the destination page just opens empty */
  }
}

/** Read and clear — a handoff applies once, not on every later visit. */
export function take() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const v = JSON.parse(raw);
    return v && typeof v.query === 'string' ? v : null;
  } catch (e) {
    return null;
  }
}
