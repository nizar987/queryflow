// Lightweight highlighter for MongoDB shell pipelines (manual per-token, DESIGN §4.4 parity).
// Highlights: $stage/$operator (accent), keys (default), strings (green), numbers (purple),
// regex/ISODate/ObjectId (teal), and marks risky bits ($where, unanchored /regex/) coral.

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightMongo(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // whitespace
    if (/\s/.test(c)) { let j = i + 1; while (j < n && /\s/.test(src[j])) j++; out += src.slice(i, j); i = j; continue; }
    // comments
    if (c === '/' && src[i + 1] === '/') { let j = i; while (j < n && src[j] !== '\n') j++; out += `<span class="tk-comment">${esc(src.slice(i, j))}</span>`; i = j; continue; }
    // strings
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      j = Math.min(n, j + 1);
      out += `<span class="tk-str">${esc(src.slice(i, j))}</span>`; i = j; continue;
    }
    // regex literal /.../flags  → risky if not anchored with ^
    if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') {
      let j = i + 1; while (j < n && src[j] !== '/') { if (src[j] === '\\') j++; j++; }
      j = Math.min(n, j + 1);
      while (j < n && /[a-z]/i.test(src[j])) j++;
      const raw = src.slice(i, j);
      const risky = !/^\/\^/.test(raw);
      out += `<span class="${risky ? 'tk-risky' : 'tk-fn'}">${esc(raw)}</span>`; i = j; continue;
    }
    // $operator / $stage
    if (c === '$') {
      let j = i + 1; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const risky = word === '$where' || word === '$function';
      out += `<span class="${risky ? 'tk-risky' : 'tk-kw'}">${esc(word)}</span>`; i = j; continue;
    }
    // number
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i + 1; while (j < n && /[0-9.]/.test(src[j])) j++;
      out += `<span class="tk-num">${esc(src.slice(i, j))}</span>`; i = j; continue;
    }
    // word — could be ISODate/ObjectId call, identifier key, or true/false/null
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let k = j; while (k < n && /\s/.test(src[k])) k++;
      if (src[k] === '(') out += `<span class="tk-fn">${esc(word)}</span>`;
      else if (word === 'true' || word === 'false' || word === 'null') out += `<span class="tk-num">${esc(word)}</span>`;
      else if (word === 'db' || word === 'aggregate' || word === 'find') out += `<span class="tk-kw">${esc(word)}</span>`;
      else out += `<span class="tk-ident">${esc(word)}</span>`;
      i = j; continue;
    }
    out += `<span class="tk-punct">${esc(c)}</span>`; i++;
  }
  return out;
}
