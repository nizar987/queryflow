// What ⌘↵ should run: the selected text when there is one, the whole editor
// otherwise. A selection of only whitespace is a stray drag, not a request to
// run nothing.

/**
 * @param {string} value editor text
 * @param {number} start selectionStart
 * @param {number} end selectionEnd
 * @returns {{ text: string, selection: boolean }}
 */
export function runTarget(value, start, end) {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const picked = to > from ? value.slice(from, to) : '';
  return picked.trim() ? { text: picked, selection: true } : { text: value, selection: false };
}
