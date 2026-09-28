// Which live session may be stopped, and why not.
//
// Kept apart from the runner so the rule can be tested without a database: it
// is the part that decides whether a signal reaches a real server process, and
// "we think it's fine" is not good enough for that.

/**
 * @param {Array<{id: string, internal?: boolean, command?: string}>} processes
 *        a *freshly read* process list — never the browser's copy
 * @param {string|number} id
 * @returns {object} the target session
 * @throws when the session is gone or must not be signalled
 */
export function assertKillable(processes, id) {
  const wanted = String(id);
  const target = (processes || []).find((p) => String(p.id) === wanted);

  if (!target) {
    // Either it finished on its own, or the browser is showing a stale list.
    // Killing "whatever has that id now" would hit an unrelated session.
    throw expected(`Sesi ${wanted} sudah tidak ada — mungkin baru saja selesai.`);
  }
  if (target.internal) {
    // checkpointer, walwriter, autovacuum, MySQL Daemon threads: signalling
    // these from a query tool ranges from useless to harmful.
    throw expected(
      `Sesi ${wanted} adalah proses internal server (${target.command || 'internal'}) — tidak dihentikan.`
    );
  }
  return target;
}

function expected(message) {
  const err = new Error(message);
  err.expected = true;
  return err;
}
