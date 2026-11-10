import { ExprError } from './errors';

export type TokenType = 'num' | 'str' | 'ident' | 'op' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  num?: number;
  pos: number;
}

const TWO_CHAR_OPS = ['==', '!=', '<=', '>=', '&&', '||'];
const ONE_CHAR_OPS = '<>+-*/%!?:.,()[]';

/** Hand-written tokenizer for the CEL subset described in EXPRESSIONS.md. */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    // Numbers: integers or decimals (12, 0.5). A leading dot is not a number.
    if (c >= '0' && c <= '9') {
      const start = i;
      while (i < n && src[i] >= '0' && src[i] <= '9') i++;
      if (src[i] === '.' && i + 1 < n && src[i + 1] >= '0' && src[i + 1] <= '9') {
        i++;
        while (i < n && src[i] >= '0' && src[i] <= '9') i++;
      }
      const text = src.slice(start, i);
      tokens.push({ type: 'num', value: text, num: Number(text), pos: start });
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      let out = '';
      let closed = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') {
          const nx = src[i + 1];
          if (nx === '\\') out += '\\';
          else if (nx === "'") out += "'";
          else if (nx === '"') out += '"';
          else if (nx === 'n') out += '\n';
          else throw new ExprError('syntax', `invalid escape at ${i}`);
          i += 2;
          continue;
        }
        if (ch === quote) {
          closed = true;
          i++;
          break;
        }
        out += ch;
        i++;
      }
      if (!closed) throw new ExprError('syntax', `unterminated string at ${start}`);
      tokens.push({ type: 'str', value: out, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      tokens.push({ type: 'ident', value: src.slice(start, i), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ type: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(c)) {
      tokens.push({ type: 'op', value: c, pos: i });
      i++;
      continue;
    }
    throw new ExprError('syntax', `unexpected character '${c}' at ${i}`);
  }
  tokens.push({ type: 'eof', value: '', pos: n });
  return tokens;
}
