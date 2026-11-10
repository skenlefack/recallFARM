/**
 * RecallFarm expression language — CEL subset (MVP).
 * Contract: packages/params/EXPRESSIONS.md. Must pass packages/params/vectors/expressions.json.
 * Used by the form renderer (visible_if, required_if, computed, default) and by the studio
 * (live syntax check of step conditions).
 */

export type ExprErrorCode =
  | 'syntax'
  | 'unknown_function'
  | 'type'
  | 'null_operand'
  | 'division_by_zero'
  | 'budget'
  | 'arity';

export type ExprValue = null | boolean | number | string | ExprValue[] | { [k: string]: ExprValue };
export type ExprResult = { ok: true; value: ExprValue } | { ok: false; error: ExprErrorCode; message?: string };
export type ExprContext = Record<string, unknown>;

export class ExprError extends Error {
  constructor(public code: ExprErrorCode, message?: string) {
    super(message ?? code);
  }
}

export const BUDGET = 10_000;

/* ------------------------------------------------------------------ lexer */

type Tok =
  | { t: 'num'; v: number; p: number }
  | { t: 'str'; v: string; p: number }
  | { t: 'id'; v: string; p: number }
  | { t: 'op'; v: string; p: number }
  | { t: 'eof'; p: number };

const OPS = ['||', '&&', '==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '%', '!', '?', ':', '.', '[', ']', '(', ')', ','];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) {
        j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      out.push({ t: 'num', v: Number(src.slice(i, j)), p: i });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      let closed = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') {
          const e = src[j + 1];
          if (e === 'n') s += '\n';
          else if (e === '\\' || e === "'" || e === '"') s += e;
          else throw new ExprError('syntax', `échappement invalide à ${j}`);
          j += 2;
          continue;
        }
        if (d === c) {
          closed = true;
          j++;
          break;
        }
        s += d;
        j++;
      }
      if (!closed) throw new ExprError('syntax', 'chaîne non terminée');
      out.push({ t: 'str', v: s, p: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j), p: i });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError('syntax', `caractère inattendu « ${c} » à ${i}`);
    out.push({ t: 'op', v: op, p: i });
    i += op.length;
  }
  out.push({ t: 'eof', p: src.length });
  return out;
}

/* ----------------------------------------------------------------- parser */

export type Node =
  | { k: 'lit'; v: ExprValue }
  | { k: 'id'; name: string }
  | { k: 'list'; items: Node[] }
  | { k: 'member'; obj: Node; name: string }
  | { k: 'index'; obj: Node; idx: Node }
  | { k: 'call'; fn: string; args: Node[] }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'tern'; c: Node; a: Node; b: Node };

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return (t.t === 'op' && t.v === v) || (v === 'in' && t.t === 'id' && t.v === 'in');
  }
  private eat(v: string): void {
    if (!this.isOp(v)) throw new ExprError('syntax', `« ${v} » attendu à ${this.peek().p}`);
    this.i++;
  }

  parse(): Node {
    const n = this.expr();
    if (this.peek().t !== 'eof') throw new ExprError('syntax', `jeton inattendu à ${this.peek().p}`);
    return n;
  }

  private expr(): Node {
    const c = this.or();
    if (this.isOp('?')) {
      this.i++;
      const a = this.expr();
      this.eat(':');
      const b = this.expr();
      return { k: 'tern', c, a, b };
    }
    return c;
  }
  private binLevel(next: () => Node, ops: string[]): Node {
    let a = next();
    for (;;) {
      const op = ops.find((o) => this.isOp(o));
      if (!op) return a;
      this.i++;
      a = { k: 'bin', op, a, b: next() };
    }
  }
  private or = (): Node => this.binLevel(this.and, ['||']);
  private and = (): Node => this.binLevel(this.equality, ['&&']);
  private equality = (): Node => this.binLevel(this.relation, ['==', '!=']);
  private relation = (): Node => this.binLevel(this.additive, ['<=', '>=', '<', '>', 'in']);
  private additive = (): Node => this.binLevel(this.mult, ['+', '-']);
  private mult = (): Node => this.binLevel(this.unary, ['*', '/', '%']);

  private unary = (): Node => {
    if (this.isOp('!') || this.isOp('-')) {
      const op = (this.peek() as { v: string }).v;
      this.i++;
      return { k: 'un', op, a: this.unary() };
    }
    return this.postfix();
  };

  private postfix(): Node {
    let n = this.primary();
    for (;;) {
      if (this.isOp('.')) {
        this.i++;
        const t = this.peek();
        if (t.t !== 'id') throw new ExprError('syntax', `identifiant attendu à ${t.p}`);
        this.i++;
        n = { k: 'member', obj: n, name: t.v };
      } else if (this.isOp('[')) {
        this.i++;
        const idx = this.expr();
        this.eat(']');
        n = { k: 'index', obj: n, idx };
      } else if (this.isOp('(')) {
        if (n.k !== 'id') throw new ExprError('syntax', 'appel de fonction invalide');
        this.i++;
        const args = this.isOp(')') ? [] : this.args();
        this.eat(')');
        n = { k: 'call', fn: n.name, args };
      } else return n;
    }
  }

  private args(): Node[] {
    const out = [this.expr()];
    while (this.isOp(',')) {
      this.i++;
      out.push(this.expr());
    }
    return out;
  }

  private primary(): Node {
    const t = this.peek();
    if (t.t === 'num' || t.t === 'str') {
      this.i++;
      return { k: 'lit', v: t.v };
    }
    if (t.t === 'id') {
      this.i++;
      if (t.v === 'true') return { k: 'lit', v: true };
      if (t.v === 'false') return { k: 'lit', v: false };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (t.v === 'in') throw new ExprError('syntax', `« in » inattendu à ${t.p}`);
      return { k: 'id', name: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const e = this.expr();
      this.eat(')');
      return e;
    }
    if (t.t === 'op' && t.v === '[') {
      this.i++;
      const items = this.isOp(']') ? [] : this.args();
      this.eat(']');
      return { k: 'list', items };
    }
    throw new ExprError('syntax', t.t === 'eof' ? 'expression incomplète' : `jeton inattendu à ${t.p}`);
  }
}

const cache = new Map<string, Node>();

export function parse(src: string): Node {
  const hit = cache.get(src);
  if (hit) return hit;
  const node = new Parser(lex(src)).parse();
  if (cache.size > 500) cache.clear();
  cache.set(src, node);
  return node;
}

/* -------------------------------------------------------------- evaluator */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, ExprValue> => typeof v === 'object' && v !== null && !Array.isArray(v);

function deepEq(a: ExprValue, b: ExprValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEq(a[k], b[k]));
  }
  return false;
}

export function roundHalfUp(x: number, n = 0): number {
  const f = 10 ** n;
  const v = Number((Math.abs(x) * f).toPrecision(15));
  const r = Math.round(v) / f;
  return x < 0 ? -r : r;
}

const DAY = 86_400_000;
function toDay(v: ExprValue): number {
  if (v === null) throw new ExprError('null_operand');
  if (typeof v !== 'string') throw new ExprError('type', 'date attendue');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) throw new ExprError('type', `date invalide « ${v} »`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY;
}
function fromDay(d: number): string {
  return new Date(d * DAY).toISOString().slice(0, 10);
}

function numList(v: ExprValue): number[] {
  if (v === null) throw new ExprError('null_operand');
  if (!Array.isArray(v)) throw new ExprError('type', 'liste attendue');
  return v.map((x) => {
    if (x === null) throw new ExprError('null_operand');
    if (!isNum(x)) throw new ExprError('type', 'liste de nombres attendue');
    return x;
  });
}

function needNum(v: ExprValue): number {
  if (v === null) throw new ExprError('null_operand');
  if (!isNum(v)) throw new ExprError('type', 'nombre attendu');
  return v;
}
function needBool(v: ExprValue): boolean {
  if (typeof v !== 'boolean') throw new ExprError('type', 'booléen attendu');
  return v;
}

function normalize(v: unknown): ExprValue {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v as ExprValue;
}

const FUNCS = new Set([
  'size', 'has', 'coalesce', 'if', 'round', 'abs', 'min', 'max', 'sum', 'avg', 'count', 'days_between', 'add_days', 'age_days',
]);

class Evaluator {
  private ops = 0;
  constructor(private ctx: ExprContext) {}

  private tick() {
    if (++this.ops > BUDGET) throw new ExprError('budget');
  }

  ev(n: Node): ExprValue {
    this.tick();
    switch (n.k) {
      case 'lit':
        return n.v;
      case 'id':
        return normalize(this.ctx[n.name]);
      case 'list':
        return n.items.map((x) => this.ev(x));
      case 'member': {
        const o = this.ev(n.obj);
        if (o === null) return null;
        if (!isObj(o)) throw new ExprError('type', `accès à « ${n.name} » sur une valeur non objet`);
        return normalize(o[n.name]);
      }
      case 'index': {
        const o = this.ev(n.obj);
        const i = this.ev(n.idx);
        if (o === null) return null;
        if (Array.isArray(o)) {
          const k = needNum(i);
          return normalize(o[k]);
        }
        if (isObj(o)) {
          if (typeof i !== 'string') throw new ExprError('type', 'clé texte attendue');
          return normalize(o[i]);
        }
        throw new ExprError('type', 'indexation invalide');
      }
      case 'un': {
        const a = this.ev(n.a);
        if (n.op === '!') return !needBool(a);
        return -needNum(a);
      }
      case 'tern':
        return needBool(this.ev(n.c)) ? this.ev(n.a) : this.ev(n.b);
      case 'bin':
        return this.bin(n.op, n.a, n.b);
      case 'call':
        return this.call(n.fn, n.args);
    }
  }

  private bin(op: string, an: Node, bn: Node): ExprValue {
    if (op === '&&') return needBool(this.ev(an)) ? needBool(this.ev(bn)) : false;
    if (op === '||') return needBool(this.ev(an)) ? true : needBool(this.ev(bn));
    const a = this.ev(an);
    const b = this.ev(bn);
    switch (op) {
      case '==':
        return deepEq(a, b);
      case '!=':
        return !deepEq(a, b);
      case 'in':
        if (b === null) throw new ExprError('null_operand');
        if (Array.isArray(b)) return b.some((x) => deepEq(x, a));
        if (isObj(b)) {
          if (typeof a !== 'string') throw new ExprError('type');
          return Object.prototype.hasOwnProperty.call(b, a);
        }
        throw new ExprError('type', '« in » attend une liste ou un objet');
      case '<':
      case '<=':
      case '>':
      case '>=': {
        if (a === null || b === null) throw new ExprError('null_operand');
        const ok = (isNum(a) && isNum(b)) || (typeof a === 'string' && typeof b === 'string');
        if (!ok) throw new ExprError('type', 'comparaison de types différents');
        const x = a as number | string;
        const y = b as number | string;
        return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
      }
      case '+':
        if (a === null || b === null) throw new ExprError('null_operand');
        if (typeof a === 'string' && typeof b === 'string') return a + b;
        if (isNum(a) && isNum(b)) return a + b;
        throw new ExprError('type', '« + » sur des types incompatibles');
      default: {
        const x = needNum(a);
        const y = needNum(b);
        if (op === '-') return x - y;
        if (op === '*') return x * y;
        if (y === 0) throw new ExprError('division_by_zero');
        return op === '/' ? x / y : x % y;
      }
    }
  }

  private call(fn: string, args: Node[]): ExprValue {
    if (!FUNCS.has(fn)) throw new ExprError('unknown_function', `fonction inconnue « ${fn} »`);
    const arity = (min: number, max = min) => {
      if (args.length < min || args.length > max) throw new ExprError('arity', `${fn} : nombre d'arguments invalide`);
    };
    switch (fn) {
      case 'if':
        arity(3);
        return needBool(this.ev(args[0])) ? this.ev(args[1]) : this.ev(args[2]);
      case 'coalesce': {
        if (args.length < 1) throw new ExprError('arity');
        for (const a of args) {
          const v = this.ev(a);
          if (v !== null) return v;
        }
        return null;
      }
      case 'has':
        arity(1);
        return this.ev(args[0]) !== null;
      case 'size': {
        arity(1);
        const v = this.ev(args[0]);
        if (v === null) throw new ExprError('null_operand');
        if (typeof v === 'string' || Array.isArray(v)) return v.length;
        if (isObj(v)) return Object.keys(v).length;
        throw new ExprError('type');
      }
      case 'round': {
        arity(1, 2);
        const x = needNum(this.ev(args[0]));
        const d = args[1] ? needNum(this.ev(args[1])) : 0;
        return roundHalfUp(x, d);
      }
      case 'abs':
        arity(1);
        return Math.abs(needNum(this.ev(args[0])));
      case 'min':
      case 'max': {
        if (args.length < 1) throw new ExprError('arity');
        const vals = args.map((a) => this.ev(a));
        const list = vals.length === 1 && Array.isArray(vals[0]) ? numList(vals[0]) : vals.map(needNum);
        if (list.length === 0) return null;
        return fn === 'min' ? Math.min(...list) : Math.max(...list);
      }
      case 'sum':
      case 'avg':
      case 'count': {
        arity(1);
        const v = this.ev(args[0]);
        if (fn === 'count') {
          if (v === null) throw new ExprError('null_operand');
          if (!Array.isArray(v)) throw new ExprError('type');
          return v.length;
        }
        const list = numList(v);
        const s = list.reduce((x, y) => x + y, 0);
        if (fn === 'sum') return s;
        return list.length ? s / list.length : null;
      }
      case 'days_between':
        arity(2);
        return Math.round(toDay(this.ev(args[1])) - toDay(this.ev(args[0])));
      case 'add_days':
        arity(2);
        return fromDay(toDay(this.ev(args[0])) + Math.trunc(needNum(this.ev(args[1]))));
      case 'age_days':
        arity(1);
        return Math.round(toDay(normalize(this.ctx.now)) - toDay(this.ev(args[0])));
    }
    throw new ExprError('unknown_function');
  }
}

/** Evaluate an expression. Never throws. */
export function evaluate(src: string, ctx: ExprContext = {}): ExprResult {
  try {
    const node = parse(src);
    return { ok: true, value: new Evaluator(ctx).ev(node) };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.code, message: e.message };
    // Pathologically deep expressions exhaust the JS stack before the op budget: same verdict.
    if (e instanceof RangeError) return { ok: false, error: 'budget', message: e.message };
    return { ok: false, error: 'type', message: String(e) };
  }
}

/** Syntax-only check (used by the studio editor). Unknown functions are also reported. */
export function check(src: string): { ok: true } | { ok: false; error: ExprErrorCode; message: string } {
  try {
    const node = parse(src);
    const walk = (n: Node): void => {
      if (n.k === 'call') {
        if (!FUNCS.has(n.fn)) throw new ExprError('unknown_function', `fonction inconnue « ${n.fn} »`);
        n.args.forEach(walk);
      } else if (n.k === 'bin') {
        walk(n.a);
        walk(n.b);
      } else if (n.k === 'un') walk(n.a);
      else if (n.k === 'tern') {
        walk(n.c);
        walk(n.a);
        walk(n.b);
      } else if (n.k === 'member') walk(n.obj);
      else if (n.k === 'index') {
        walk(n.obj);
        walk(n.idx);
      } else if (n.k === 'list') n.items.forEach(walk);
    };
    walk(node);
    return { ok: true };
  } catch (e) {
    const err = e instanceof ExprError ? e : new ExprError('syntax', String(e));
    return { ok: false, error: err.code, message: err.message };
  }
}

/** Convenience for boolean conditions (visible_if, required_if): errors and null → fallback. */
export function truthy(src: string | undefined | null, ctx: ExprContext, fallback = false): boolean {
  if (!src) return fallback;
  const r = evaluate(src, ctx);
  return r.ok && typeof r.value === 'boolean' ? r.value : fallback;
}
