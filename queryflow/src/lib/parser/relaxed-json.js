// Relaxed-JSON parser for MongoDB shell syntax.
// Handles: unquoted identifier keys, single-quoted strings, trailing commas,
// and extended-JSON call literals (ISODate(...), ObjectId(...), NumberLong(...), new Date(...)).
// Returns a plain JS object/array tree. Call literals become tagged objects:
//   { __call: 'ISODate', __raw: 'ISODate("2026-01-01")' }
// No eval — safe to run on untrusted input.

export function parseRelaxed(text) {
  const p = new RJParser(text);
  const value = p.parseValue();
  p.skipWs();
  if (!p.eof()) throw new RJError(`Token tak terduga '${p.peek()}'`, p.pos);
  return value;
}

class RJError extends Error {
  constructor(msg, pos) {
    super(msg);
    this.pos = pos;
  }
}

class RJParser {
  constructor(s) {
    this.s = s;
    this.pos = 0;
  }
  eof() {
    return this.pos >= this.s.length;
  }
  peek() {
    return this.s[this.pos];
  }
  skipWs() {
    while (this.pos < this.s.length) {
      const c = this.s[this.pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',') {
        this.pos++;
      } else if (c === '/' && this.s[this.pos + 1] === '/') {
        while (this.pos < this.s.length && this.s[this.pos] !== '\n') this.pos++;
      } else if (c === '/' && this.s[this.pos + 1] === '*') {
        this.pos += 2;
        while (this.pos < this.s.length && !(this.s[this.pos] === '*' && this.s[this.pos + 1] === '/')) this.pos++;
        this.pos += 2;
      } else break;
    }
  }
  parseValue() {
    this.skipWs();
    const c = this.peek();
    if (c === '{') return this.parseObject();
    if (c === '[') return this.parseArray();
    if (c === '"' || c === "'") return this.parseString();
    if (c === '/' && this.s[this.pos + 1] !== '/' && this.s[this.pos + 1] !== '*') return this.parseRegex();
    if (c === '-' || (c >= '0' && c <= '9')) return this.parseNumber();
    return this.parseWordOrCall();
  }
  parseObject() {
    const obj = {};
    this.pos++; // {
    this.skipWs();
    if (this.peek() === '}') { this.pos++; return obj; }
    while (!this.eof()) {
      this.skipWs();
      const key = this.parseKey();
      this.skipWs();
      if (this.peek() !== ':') throw new RJError(`Diharapkan ':' setelah key '${key}'`, this.pos);
      this.pos++;
      const val = this.parseValue();
      obj[key] = val;
      this.skipWs();
      if (this.peek() === '}') { this.pos++; return obj; }
      // commas already eaten by skipWs
      if (this.eof()) break;
    }
    throw new RJError('Objek tidak ditutup dengan }', this.pos);
  }
  parseArray() {
    const arr = [];
    this.pos++; // [
    this.skipWs();
    if (this.peek() === ']') { this.pos++; return arr; }
    while (!this.eof()) {
      const val = this.parseValue();
      arr.push(val);
      this.skipWs();
      if (this.peek() === ']') { this.pos++; return arr; }
      if (this.eof()) break;
    }
    throw new RJError('Array tidak ditutup dengan ]', this.pos);
  }
  parseKey() {
    const c = this.peek();
    if (c === '"' || c === "'") return this.parseString();
    // unquoted identifier (may include $ . and digits)
    let start = this.pos;
    while (this.pos < this.s.length && /[A-Za-z0-9_$.]/.test(this.s[this.pos])) this.pos++;
    if (this.pos === start) throw new RJError('Key kosong/tidak valid', this.pos);
    return this.s.slice(start, this.pos);
  }
  parseString() {
    const quote = this.s[this.pos];
    this.pos++;
    let out = '';
    while (this.pos < this.s.length) {
      const c = this.s[this.pos];
      if (c === '\\') {
        const n = this.s[this.pos + 1];
        const map = { n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\', '/': '/' };
        out += map[n] !== undefined ? map[n] : n;
        this.pos += 2;
        continue;
      }
      if (c === quote) { this.pos++; return out; }
      out += c;
      this.pos++;
    }
    throw new RJError('String tidak ditutup', this.pos);
  }
  parseRegex() {
    let start = this.pos;
    this.pos++; // opening /
    let pattern = '';
    while (this.pos < this.s.length) {
      const c = this.s[this.pos];
      if (c === '\\') { pattern += c + (this.s[this.pos + 1] || ''); this.pos += 2; continue; }
      if (c === '/') { this.pos++; break; }
      pattern += c;
      this.pos++;
    }
    let flags = '';
    while (this.pos < this.s.length && /[a-z]/i.test(this.s[this.pos])) { flags += this.s[this.pos]; this.pos++; }
    return { __regex: pattern, __flags: flags, __raw: this.s.slice(start, this.pos) };
  }
  parseNumber() {
    let start = this.pos;
    if (this.peek() === '-') this.pos++;
    while (this.pos < this.s.length && /[0-9.eE+\-]/.test(this.s[this.pos])) this.pos++;
    const raw = this.s.slice(start, this.pos);
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  parseWordOrCall() {
    let start = this.pos;
    // handle "new Xxx(...)"
    if (this.s.slice(this.pos, this.pos + 4) === 'new ') this.pos += 4;
    while (this.pos < this.s.length && /[A-Za-z0-9_$]/.test(this.s[this.pos])) this.pos++;
    let word = this.s.slice(start, this.pos);
    this.skipWsNoComma();
    if (this.peek() === '(') {
      // call literal — capture raw balanced parens
      const callStart = start;
      let depth = 0;
      let i = this.pos;
      for (; i < this.s.length; i++) {
        if (this.s[i] === '(') depth++;
        else if (this.s[i] === ')') { depth--; if (depth === 0) { i++; break; } }
        else if (this.s[i] === '"' || this.s[i] === "'") {
          const q = this.s[i++];
          while (i < this.s.length && this.s[i] !== q) { if (this.s[i] === '\\') i++; i++; }
        }
      }
      const raw = this.s.slice(callStart, i).trim();
      this.pos = i;
      const nameMatch = /^(?:new\s+)?([A-Za-z0-9_$]+)/.exec(raw);
      return { __call: nameMatch ? nameMatch[1] : word, __raw: raw };
    }
    // literals
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    if (word === 'undefined') return null;
    if (word === '') throw new RJError(`Token tak dikenal '${this.s[this.pos] || 'EOF'}'`, this.pos);
    return { __ident: word };
  }
  skipWsNoComma() {
    while (this.pos < this.s.length && /[ \t\n\r]/.test(this.s[this.pos])) this.pos++;
  }
}

/** True if a value is a tagged call literal like ISODate(...). */
export function isCall(v) {
  return v && typeof v === 'object' && typeof v.__call === 'string';
}
/** Render a relaxed-JSON value back to compact display string. */
export function stringifyRelaxed(v, depth = 0) {
  if (v === null) return 'null';
  if (isCall(v)) return v.__raw;
  if (v && typeof v === 'object' && typeof v.__regex === 'string') return v.__raw;
  if (v && typeof v === 'object' && v.__ident) return v.__ident;
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map((x) => stringifyRelaxed(x, depth + 1)).join(', ') + ']';
  if (typeof v === 'object') {
    const parts = Object.entries(v).map(([k, val]) => `${k}: ${stringifyRelaxed(val, depth + 1)}`);
    return '{ ' + parts.join(', ') + ' }';
  }
  return String(v);
}
