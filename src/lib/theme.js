// Theme preference — 'dark' | 'light' | 'system'.
// Persisted locally (the app is offline-first; nothing leaves the browser).
const KEY = 'qf_theme';

export function readPreference() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch (e) {
    /* private mode / storage disabled — fall through to default */
  }
  return 'system';
}

function systemIsLight() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
}

/** Resolve a preference to the concrete theme actually painted. */
export function resolve(pref) {
  if (pref === 'system') return systemIsLight() ? 'light' : 'dark';
  return pref;
}

/** Paint `pref` onto <html>. `animate` fades surfaces (skip it on first paint). */
export function applyTheme(pref, animate = false) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-anim');
    setTimeout(() => root.classList.remove('theme-anim'), 260);
  }
  root.dataset.theme = resolve(pref);
  try {
    localStorage.setItem(KEY, pref);
  } catch (e) {
    /* ignore */
  }
}

/** Re-paint when the OS flips, but only while the user is on 'system'. */
export function watchSystem(getPref) {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: light)');
  const onChange = () => {
    if (getPref() === 'system') document.documentElement.dataset.theme = resolve('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
