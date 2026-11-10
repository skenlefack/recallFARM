import { addDays, daysBetween, isDateString, parseDateMs } from '../../common/dates';
import { ExprError } from './errors';
import { Node, parse } from './parser';

export const EXPR_BUDGET = 10_000;

export type ExprResult = { ok: true; value: unknown } | { ok: false; error: string; message?: string };

type Ctx = Record<string, unknown>;

interface State {
  ops: number;
  ctx: Ctx;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a == null && b == null;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function norm(v: unknown): unknown {
  return v === undefined ? null : v;
}

function num(v: unknown): number {
  if (v === null || v === undefined) throw new ExprError('null_operand');
  if (typeof v !== 'number') throw new ExprError('type', `number expected, got ${typeof v}`);
  return v;
}

function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') throw new ExprError('type', 'boolean expected');
  return v;
}

function dateArg(v: unknown): string {
  if (v === null || v === undefined) throw new ExprError('null_operand');
  if (typeof v !== 'string' || Number.isNaN(parseDateMs(v))) throw new ExprError('type', 'date expected');
  return v;
}

/** "Half up in absolute value" rounding to n decimals (EXPRESSIONS.md). */
export function roundHalfAwayFromZero(x: number, n = 0): number {
  const f = Math.pow(10, n);
  // Normalise to 15 significant digits first (same as the Dart engine): 1.005 * 1000 → 1005.
  const scaled = Number((Math.abs(x) * f).toPrecision(15));
  const r = (Math.sign(x) * Math.floor(scaled + 0.5)) / f;
  return r === 0 ? 0 : r;
}

function numberList(v: unknown): number[] {
  if (v === null || v === undefined) throw new ExprError('null_operand');
  if (!Array.isArray(v)) throw new ExprError('type', 'list expected');
  return v.map((x) => num(x));
}

function arity(name: string, args: Node[], min: number, max = min): void {
  if (args.length < min || args.length > max) throw new ExprError('arity', `${name}: wrong number of arguments`);
}

function tick(s: State): void {
  s.ops++;
  if (s.ops > EXPR_BUDGET) throw new ExprError('budget');
}

function evalNode(node: Node, s: State): unknown {
  tick(s);
  switch (node.t) {
    case 'lit':
      return node.v;
    case 'ident':
      return Object.prototype.hasOwnProperty.call(s.ctx, node.name) ? norm(s.ctx[node.name]) : null;
    case 'list':
      return node.items.map((i) => evalNode(i, s));
    case 'member': {
      const obj = evalNode(node.obj, s);
      if (obj === null) return null;
      if (!isPlainObject(obj)) throw new ExprError('type', `cannot access '${node.name}'`);
      return Object.prototype.hasOwnProperty.call(obj, node.name) ? norm(obj[node.name]) : null;
    }
    case 'index': {
      const obj = evalNode(node.obj, s);
      const idx = evalNode(node.index, s);
      if (obj === null) return null;
      if (Array.isArray(obj)) {
        const i = num(idx);
        if (!Number.isInteger(i)) throw new ExprError('type', 'integer index expected');
        return i >= 0 && i < obj.length ? norm(obj[i]) : null;
      }
      if (isPlainObject(obj)) {
        if (typeof idx !== 'string') throw new ExprError('type', 'string key expected');
        return Object.prototype.hasOwnProperty.call(obj, idx) ? norm(obj[idx]) : null;
      }
      throw new ExprError('type', 'cannot index');
    }
    case 'unary': {
      const v = evalNode(node.arg, s);
      if (node.op === '!') return !bool(v);
      const r = -num(v);
      return r === 0 ? 0 : r;
    }
    case 'ternary': {
      const c = evalNode(node.cond, s);
      return bool(c) ? evalNode(node.then, s) : evalNode(node.else, s);
    }
    case 'binary':
      return evalBinary(node.op, node.left, node.right, s);
    case 'call':
      return evalCall(node, s);
    default:
      throw new ExprError('syntax');
  }
}

function evalBinary(op: string, ln: Node, rn: Node, s: State): unknown {
  if (op === '&&' || op === '||') {
    const l = bool(evalNode(ln, s));
    if (op === '&&' && !l) return false;
    if (op === '||' && l) return true;
    return bool(evalNode(rn, s));
  }
  const l = evalNode(ln, s);
  const r = evalNode(rn, s);
  switch (op) {
    case '==':
      return deepEqual(l, r);
    case '!=':
      return !deepEqual(l, r);
    case '+': {
      if (l === null || r === null) throw new ExprError('null_operand');
      if (typeof l === 'number' && typeof r === 'number') return l + r;
      if (typeof l === 'string' && typeof r === 'string') return l + r;
      throw new ExprError('type', "'+' expects two numbers or two strings");
    }
    case '-':
      return num(l) - num(r);
    case '*':
      return num(l) * num(r);
    case '/': {
      const a = num(l);
      const b = num(r);
      if (b === 0) throw new ExprError('division_by_zero');
      return a / b;
    }
    case '%': {
      const a = num(l);
      const b = num(r);
      if (b === 0) throw new ExprError('division_by_zero');
      return a % b;
    }
    case '<':
    case '<=':
    case '>':
    case '>=': {
      if (l === null || r === null) throw new ExprError('null_operand');
      if (!((typeof l === 'number' && typeof r === 'number') || (typeof l === 'string' && typeof r === 'string'))) {
        throw new ExprError('type', 'ordering requires two numbers or two strings');
      }
      const a = l as number | string;
      const b = r as number | string;
      if (op === '<') return a < b;
      if (op === '<=') return a <= b;
      if (op === '>') return a > b;
      return a >= b;
    }
    case 'in': {
      if (r === null) throw new ExprError('null_operand');
      if (Array.isArray(r)) return r.some((x) => deepEqual(l, x));
      if (isPlainObject(r)) {
        if (typeof l !== 'string') throw new ExprError('type', "'in' on an object expects a string key");
        return Object.prototype.hasOwnProperty.call(r, l);
      }
      throw new ExprError('type', "'in' expects a list or an object");
    }
    default:
      throw new ExprError('syntax', `unknown operator ${op}`);
  }
}

const FUNCTIONS = new Set([
  'size', 'has', 'coalesce', 'if', 'round', 'abs', 'min', 'max', 'sum', 'avg', 'count', 'days_between', 'add_days', 'age_days',
]);

export function isKnownFunction(name: string): boolean {
  return FUNCTIONS.has(name);
}

function evalCall(node: Extract<Node, { t: 'call' }>, s: State): unknown {
  if (node.callee.t !== 'ident') throw new ExprError('unknown_function', 'only global functions are supported');
  const name = node.callee.name;
  const a = node.args;
  const ev = (i: number) => evalNode(a[i], s);
  switch (name) {
    case 'size': {
      arity(name, a, 1);
      const v = ev(0);
      if (v === null) throw new ExprError('null_operand');
      if (typeof v === 'string' || Array.isArray(v)) return v.length;
      if (isPlainObject(v)) return Object.keys(v).length;
      throw new ExprError('type', 'size expects a string or a list');
    }
    case 'has':
      arity(name, a, 1);
      return ev(0) !== null;
    case 'coalesce': {
      if (a.length < 1) throw new ExprError('arity');
      for (let i = 0; i < a.length; i++) {
        const v = ev(i);
        if (v !== null) return v;
      }
      return null;
    }
    case 'if':
      arity(name, a, 3);
      return bool(ev(0)) ? ev(1) : ev(2);
    case 'round': {
      arity(name, a, 1, 2);
      const x = num(ev(0));
      const n = a.length === 2 ? num(ev(1)) : 0;
      if (!Number.isInteger(n) || n < 0 || n > 15) throw new ExprError('type', 'round: invalid number of decimals');
      return roundHalfAwayFromZero(x, n);
    }
    case 'abs':
      arity(name, a, 1);
      return Math.abs(num(ev(0)));
    case 'min':
    case 'max': {
      if (a.length < 1) throw new ExprError('arity');
      let values: number[];
      if (a.length === 1) {
        const v = ev(0);
        values = Array.isArray(v) ? numberList(v) : [num(v)];
      } else {
        values = a.map((_, i) => num(ev(i)));
      }
      if (values.length === 0) return null;
      return name === 'min' ? Math.min(...values) : Math.max(...values);
    }
    case 'sum': {
      arity(name, a, 1);
      return numberList(ev(0)).reduce((x, y) => x + y, 0);
    }
    case 'avg': {
      arity(name, a, 1);
      const l = numberList(ev(0));
      return l.length === 0 ? null : l.reduce((x, y) => x + y, 0) / l.length;
    }
    case 'count': {
      arity(name, a, 1);
      const v = ev(0);
      if (v === null) throw new ExprError('null_operand');
      if (!Array.isArray(v)) throw new ExprError('type', 'list expected');
      return v.length;
    }
    case 'days_between':
      arity(name, a, 2);
      return daysBetween(dateArg(ev(0)), dateArg(ev(1)));
    case 'add_days': {
      arity(name, a, 2);
      const d = dateArg(ev(0));
      const n = num(ev(1));
      if (!Number.isInteger(n)) throw new ExprError('type', 'add_days expects an integer');
      return addDays(d, n);
    }
    case 'age_days': {
      arity(name, a, 1);
      const d = dateArg(ev(0));
      const now = s.ctx.now;
      if (typeof now !== 'string' || !isDateString(now.slice(0, 10))) throw new ExprError('null_operand', 'now is not set');
      return daysBetween(d, now);
    }
    default:
      throw new ExprError('unknown_function', `unknown function ${name}`);
  }
}

/** Evaluates an expression; never throws. */
export function evaluate(src: string, ctx: Ctx = {}): ExprResult {
  try {
    const node = parse(src);
    const value = evalNode(node, { ops: 0, ctx });
    return { ok: true, value: norm(value) };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.code, message: e.message };
    if (e instanceof RangeError) return { ok: false, error: 'budget', message: 'expression too deep' };
    throw e;
  }
}

/** Evaluates an expression and throws ExprError on failure. */
export function evaluateOrThrow(src: string, ctx: Ctx = {}): unknown {
  const r = evaluate(src, ctx);
  if (!r.ok) throw new ExprError(r.error as never, r.message);
  return r.value;
}

/** Evaluates a boolean condition; errors and non-booleans count as false (used for alert rules). */
export function evaluateCondition(src: string, ctx: Ctx): { value: boolean; error?: string } {
  const r = evaluate(src, ctx);
  if (!r.ok) return { value: false, error: r.error };
  return { value: r.value === true };
}
