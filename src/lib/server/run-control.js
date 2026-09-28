// Cancel and time-limit a query while it runs.
//
// The browser can stop waiting on its own, but that leaves the statement
// running on the database — on a production server that is the whole problem.
// So cancelling is done by the engine: each driver registers how to abort its
// own statement (KILL QUERY, pg_cancel_backend, killOp) and this module decides
// *when*: on the user's request, or when the connection's time limit passes.
//
// Runs are addressed by an id the browser generates, because the cancel
// request arrives on a different HTTP request than the one that is waiting.
import { randomUUID } from 'node:crypto';
import { formatElapsed } from '../duration.js';

export const DEFAULT_QUERY_TIMEOUT_SEC = 30;
export const MAX_QUERY_TIMEOUT_SEC = 3600;

/** runId -> control, only while the statement is in flight. */
const runs = new Map();

/**
 * A profile's limit in ms; 0 means no limit. Profiles saved before the setting existed get the default.
 * @param {{ queryTimeoutSec?: unknown } | null | undefined} conn
 * @returns {number}
 */
export function timeoutMsFor(conn) {
  const v = conn ? conn.queryTimeoutSec : undefined;
  const sec = typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : DEFAULT_QUERY_TIMEOUT_SEC;
  return sec * 1000;
}

export function activeRunCount() {
  return runs.size;
}

/** @param {string} message @param {string} code @param {unknown} [cause] */
function expectedError(message, code, cause) {
  return Object.assign(new Error(message), { expected: true, code, cause });
}

/** @typedef {ReturnType<typeof createRunControl>} RunControl */

/**
 * @param {{ runId?: string | null, timeoutMs?: number }} opts
 */
export function createRunControl({ runId = null, timeoutMs = 0 } = {}) {
  if (runId && runs.has(runId)) {
    throw expectedError('ID eksekusi ini sudah dipakai query lain yang masih berjalan.', 'RUN_ID_IN_USE');
  }

  let started = Date.now();
  /** @type {null | ReturnType<typeof setTimeout>} */
  let timer = null;
  /** @type {null | (() => Promise<void>)} */
  let handler = null;
  /** @type {null | 'user' | 'timeout'} */
  let reason = null;
  let fired = false;
  /** @type {Promise<void>} */
  let pending = Promise.resolve();

  function fire() {
    if (fired || !handler || !reason) return pending;
    fired = true;
    const kill = handler;
    pending = Promise.resolve()
      .then(() => kill())
      .catch((e) => {
        // The statement is still running. Forget the reason so its eventual
        // result — or its own error — is reported as what it really is.
        reason = null;
        fired = false;
        throw e;
      });
    return pending;
  }

  const control = {
    runId,
    /** Always set, even without a runId: drivers tag their statement with it, and a
     *  time-out must only ever find this run's own statement. */
    tag: `queryflow:${runId || randomUUID()}`,
    get reason() {
      return reason;
    },

    /**
     * Drivers call this once they know how to reach their statement.
     * @param {() => Promise<void>} fn
     */
    onCancel(fn) {
      handler = fn;
      fire().catch(() => {}); // reported to whoever called cancel()
    },

    /** @param {'user' | 'timeout'} why */
    async cancel(why = 'user') {
      if (!reason) reason = why;
      await fire();
    },

    /** Resolves once an in-flight kill is over, so a driver never recycles a connection mid-kill. */
    settled() {
      return pending.catch(() => {});
    },

    /**
     * A batch gives each statement the full limit: the setting reads as "per
     * query", and a script of five 20-second reports should not die at 30.
     */
    startStatement() {
      started = Date.now();
      arm();
    },

    /** For drivers: stop before starting a statement that was already cancelled. */
    throwIfCancelled() {
      if (reason) throw control.translate(new Error('cancelled before start'));
    },

    /**
     * Replace the engine's "interrupted" error with one that says why.
     * @param {unknown} err
     */
    translate(err) {
      if (!reason) return err;
      if (reason === 'timeout') {
        return expectedError(
          `Query dihentikan karena melewati batas waktu ${Math.round(timeoutMs / 1000)} detik untuk koneksi ini. ` +
            'Kalau query ini memang berat, naikkan batas waktunya di Kelola koneksi.',
          'QUERY_TIMEOUT',
          err
        );
      }
      return expectedError(
        `Query dibatalkan setelah ${formatElapsed(Date.now() - started)}. Statement dihentikan di database.`,
        'QUERY_CANCELLED',
        err
      );
    },

    done() {
      if (timer) clearTimeout(timer);
      if (runId && runs.get(runId) === control) runs.delete(runId);
    }
  };

  function arm() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!(timeoutMs > 0)) return;
    timer = setTimeout(() => {
      control.cancel('timeout').catch((e) => {
        console.error(`[queryflow] gagal menghentikan query yang melewati batas waktu: ${e instanceof Error ? e.message : String(e)}`);
      });
    }, timeoutMs);
    // A pending limit must not keep the server process alive on shutdown.
    if (typeof timer.unref === 'function') timer.unref();
  }
  arm();

  if (runId) runs.set(runId, control);
  return control;
}

/**
 * Cancel a run by id, on behalf of the user.
 * @param {string} runId
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export async function cancelRun(runId) {
  const control = runId ? runs.get(runId) : null;
  if (!control) return { ok: false, error: 'Query ini sudah tidak berjalan — mungkin baru saja selesai.' };
  try {
    await control.cancel('user');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Gagal membatalkan: ${e instanceof Error ? e.message : String(e)}` };
  }
}
