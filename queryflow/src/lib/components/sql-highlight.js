// Lightweight SQL tokenizer for manual syntax highlighting (DESIGN §4.4).
// Keyword → accent; risky patterns (SELECT *, leading-wildcard LIKE, DATE()/LOWER() in filters)
// → coral preview BEFORE full analysis. Returns HTML-safe spans.

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS',
  'ON', 'USING', 'GROUP', 'BY', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'UNION', 'ALL',
  'DISTINCT', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'EXISTS',
  'WITH', 'RECURSIVE', 'OVER', 'PARTITION', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'ASC', 'DESC', 'INTO', 'VALUES', 'SET', 'DESC', 'COLLATE'
]);

const RISKY_FUNCS = new Set(['DATE', 'DATE_FORMAT', 'YEAR', 'MONTH', 'LOWER', 'UPPER', 'SUBSTRING', 'CAST', 'CONVERT']);

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Tokenize into {type, text}. Types: kw, fn, str, num, comment, ident, punct, star, ws.
export function tokenizeSQL(sql) {
  const tokens = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    // whitespace
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < n && /\s/.test(sql[j])) j++;
      tokens.push({ type: 'ws', text: sql.slice(i, j) });
      i = j;
      continue;
    }
    // line comment
    if (ch === '-' && sql[i + 1] === '-') {
      let j = i;
      while (j < n && sql[j] !== '\n') j++;
      tokens.push({ type: 'comment', text: sql.slice(i, j) });
      i = j;
      continue;
    }
    // block comment
    if (ch === '/' && sql[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
      j = Math.min(n, j + 2);
      tokens.push({ type: 'comment', text: sql.slice(i, j) });
      i = j;
      continue;
    }
    // string
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n && sql[j] !== ch) {
        if (sql[j] === '\\') j++;
        j++;
      }
      j = Math.min(n, j + 1);
      tokens.push({ type: 'str', text: sql.slice(i, j) });
      i = j;
      continue;
    }
    // backtick identifier
    if (ch === '`') {
      let j = i + 1;
      while (j < n && sql[j] !== '`') j++;
      j = Math.min(n, j + 1);
      tokens.push({ type: 'ident', text: sql.slice(i, j) });
      i = j;
      continue;
    }
    // number
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(sql[j])) j++;
      tokens.push({ type: 'num', text: sql.slice(i, j) });
      i = j;
      continue;
    }
    // word
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      const word = sql.slice(i, j);
      const upper = word.toUpperCase();
      // function if followed by '('
      let k = j;
      while (k < n && /\s/.test(sql[k])) k++;
      const isCall = sql[k] === '(';
      if (KEYWORDS.has(upper) && !isCall) tokens.push({ type: 'kw', text: word });
      else if (isCall) tokens.push({ type: 'fn', text: word, risky: RISKY_FUNCS.has(upper) });
      else tokens.push({ type: 'ident', text: word });
      i = j;
      continue;
    }
    // star
    if (ch === '*') {
      tokens.push({ type: 'star', text: '*' });
      i++;
      continue;
    }
    // punctuation / operators
    tokens.push({ type: 'punct', text: ch });
    i++;
  }
  return tokens;
}

// Produce highlighted HTML. Marks SELECT * and leading-wildcard strings as risky (coral).
export function highlightSQL(sql) {
  const tokens = tokenizeSQL(sql);
  let html = '';
  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];
    const text = esc(t.text);
    switch (t.type) {
      case 'ws':
        html += t.text;
        break;
      case 'comment':
        html += `<span class="tk-comment">${text}</span>`;
        break;
      case 'kw':
        html += `<span class="tk-kw">${text}</span>`;
        break;
      case 'fn':
        html += `<span class="${t.risky ? 'tk-risky' : 'tk-fn'}">${text}</span>`;
        break;
      case 'str': {
        const risky = /^['"]%/.test(t.text); // leading wildcard
        html += `<span class="${risky ? 'tk-risky' : 'tk-str'}">${text}</span>`;
        break;
      }
      case 'num':
        html += `<span class="tk-num">${text}</span>`;
        break;
      case 'star': {
        // SELECT * → risky preview
        const prevMeaningful = lastNonWs(tokens, idx);
        const risky = prevMeaningful && prevMeaningful.type === 'kw' && prevMeaningful.text.toUpperCase() === 'SELECT';
        html += `<span class="${risky ? 'tk-risky' : 'tk-punct'}">*</span>`;
        break;
      }
      default:
        html += `<span class="tk-punct">${text}</span>`;
    }
  }
  return html;
}

function lastNonWs(tokens, idx) {
  for (let i = idx - 1; i >= 0; i--) {
    if (tokens[i].type !== 'ws') return tokens[i];
  }
  return null;
}
