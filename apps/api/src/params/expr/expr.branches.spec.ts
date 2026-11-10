/**
 * Couverture des branches du langage d'expressions (ENF-PAR-02 / RG-PAR-02, T-50) : operateurs, erreurs de type,
 * fonctions et syntaxe. Complete les vecteurs communs (packages/params/vectors) sans les modifier.
 * Les erreurs attendues sont les codes de EXPRESSIONS.md.
 */
import { collectCalls, evaluate, evaluateCondition, evaluateOrThrow, isKnownFunction, parse, roundHalfAwayFromZero } from './index';

const ok = (src: string, ctx: Record<string, unknown> = {}) => {
  const r = evaluate(src, ctx);
  if (!r.ok) throw new Error(`${src} → ${r.error} ${r.message ?? ''}`);
  return r.value;
};
const err = (src: string, ctx: Record<string, unknown> = {}) => {
  const r = evaluate(src, ctx);
  if (r.ok) throw new Error(`${src} should fail, got ${JSON.stringify(r.value)}`);
  return r.error;
};

describe('tokenizer and parser errors (T-50)', () => {
  it.each([
    ['"abc', 'syntax'], // unterminated string
    ['"a\\qb"', 'syntax'], // invalid escape
    ['1 @ 2', 'syntax'], // unexpected character
    ['1 2', 'syntax'], // trailing token
    ['(1', 'syntax'], // missing )
    ['[1, 2', 'syntax'], // missing ]
    ['a.1', 'syntax'], // member needs an identifier
    ['a[1', 'syntax'],
    ['f(1', 'syntax'],
    ['1 ? 2', 'syntax'], // missing :
    ['in', 'syntax'], // keyword used as a value
    [')', 'syntax'],
    ['', 'syntax'], // end of expression
    ['1 +', 'syntax'],
  ])('%s → %s', (src, code) => expect(err(src)).toBe(code));

  it('reads escapes, both quote styles and decimals', () => {
    expect(ok('"a\\\\b"')).toBe('a\\b');
    expect(ok("'it\\'s'")).toBe("it's");
    expect(ok('"say \\"hi\\""')).toBe('say "hi"');
    expect(ok('"l1\\nl2"')).toBe('l1\nl2');
    expect(ok('12.5 + 0.5')).toBe(13);
    expect(ok('\t1\r\n+ 1')).toBe(2);
  });

  it('keeps a trailing dot out of a number', () => {
    expect(err('1.')).toBe('syntax');
  });

  it('parses nested postfix, calls without arguments, empty list and precedence', () => {
    expect(ok('[]')).toEqual([]);
    expect(ok('[1, 2][1]')).toBe(2);
    expect(ok('a.b.c', { a: { b: { c: 5 } } })).toBe(5);
    expect(ok('1 + 2 * 3 - 4 / 2')).toBe(5);
    expect(ok('-(1 + 2)')).toBe(-3);
    expect(ok('true ? 1 : false ? 2 : 3')).toBe(1);
    expect(ok('false ? 1 : 2')).toBe(2);
    expect(ok('1 < 2 == true')).toBe(true);
    expect(ok('1 != 2 && 2 >= 2 || false')).toBe(true);
    expect(ok('"b" in ["a", "b"]')).toBe(true);
  });

  it('caches parsed expressions, and clears the cache when it grows too large', () => {
    expect(parse('1 + 1')).toBe(parse('1 + 1'));
    for (let i = 0; i < 2100; i++) parse(`${i} + 1`);
    expect(ok('3 + 3')).toBe(6);
  });

  it('collectCalls walks every node kind', () => {
    const calls = collectCalls(parse('size([abs(1)]) + (a.b ? max(1, 2) : min(c[round(1.5)], -sum([1])))'));
    expect([...calls].sort()).toEqual(['abs', 'max', 'min', 'round', 'size', 'sum']);
    expect([...collectCalls(parse('x.y(1)'))]).toEqual([]);
    expect([...collectCalls(parse('1'))]).toEqual([]);
  });
});

describe('evaluation and type errors (T-50)', () => {
  it('compares with deep equality, null-tolerant', () => {
    expect(ok('[1, [2]] == [1, [2]]')).toBe(true);
    expect(ok('[1, 2] == [1]')).toBe(false);
    expect(ok('x == null', {})).toBe(true);
    expect(ok('x == y', { x: undefined, y: null })).toBe(true);
    expect(ok('x == 1', { x: null })).toBe(false);
    expect(ok('o == p', { o: { a: 1 }, p: { a: 1 } })).toBe(true);
    expect(ok('o == p', { o: { a: 1 }, p: { b: 1 } })).toBe(false);
    expect(ok('o == p', { o: { a: 1 }, p: { a: 1, b: 2 } })).toBe(false);
    expect(ok('1 == "1"')).toBe(false);
    expect(ok('1 != 2')).toBe(true);
    expect(ok('1 == 1')).toBe(true);
    expect(ok('1 == 2')).toBe(false);
  });

  it('refuses mixed or null operands', () => {
    expect(err('1 + "a"')).toBe('type');
    expect(err('null + 1')).toBe('null_operand');
    expect(err('"a" + null')).toBe('null_operand');
    expect(ok('"a" + "b"')).toBe('ab');
    expect(err('"a" - 1')).toBe('type');
    expect(err('x * 2', { x: null })).toBe('null_operand');
    expect(err('1 / 0')).toBe('division_by_zero');
    expect(err('1 % 0')).toBe('division_by_zero');
    expect(ok('7 % 4')).toBe(3);
    expect(ok('7 / 2')).toBe(3.5);
    expect(err('1 < null')).toBe('null_operand');
    expect(err('null < 1')).toBe('null_operand');
    expect(err('1 < "a"')).toBe('type');
    expect(err('true < false')).toBe('type');
  });

  it('orders numbers and strings', () => {
    expect(ok('1 < 2')).toBe(true);
    expect(ok('2 <= 2')).toBe(true);
    expect(ok('3 > 2')).toBe(true);
    expect(ok('2 >= 3')).toBe(false);
    expect(ok('"a" < "b"')).toBe(true);
  });

  it('applies ! and unary minus with strict types', () => {
    expect(ok('!true')).toBe(false);
    expect(err('!1')).toBe('type');
    expect(ok('-x', { x: 0 })).toBe(0);
    expect(Object.is(ok('-x', { x: 0 }), 0)).toBe(true);
    expect(err('-"a"')).toBe('type');
    expect(err('-x', { x: null })).toBe('null_operand');
  });

  it('short-circuits && and || and requires booleans', () => {
    expect(ok('false && missing_fn()')).toBe(false);
    expect(ok('true || missing_fn()')).toBe(true);
    expect(ok('true && false')).toBe(false);
    expect(ok('false || true')).toBe(true);
    expect(err('1 && true')).toBe('type');
    expect(err('true && 1')).toBe('type');
    expect(err('1 ? 2 : 3')).toBe('type');
  });

  it('reads members and indexes', () => {
    expect(ok('a.b', { a: null })).toBeNull();
    expect(ok('a.b', { a: { c: 1 } })).toBeNull();
    expect(err('a.b', { a: 1 })).toBe('type');
    expect(ok('a[0]', { a: [7] })).toBe(7);
    expect(ok('a[5]', { a: [7] })).toBeNull();
    expect(ok('a[-1]', { a: [7] })).toBeNull();
    expect(err('a[0.5]', { a: [7] })).toBe('type');
    expect(err('a["x"]', { a: [7] })).toBe('type');
    expect(ok('a[0]', { a: null })).toBeNull();
    expect(ok('a["k"]', { a: { k: 2 } })).toBe(2);
    expect(ok('a["z"]', { a: { k: 2 } })).toBeNull();
    expect(err('a[1]', { a: { k: 2 } })).toBe('type');
    expect(err('a[0]', { a: 5 })).toBe('type');
    expect(ok('a[0]', { a: [undefined] })).toBeNull();
  });

  it('implements `in` on lists and objects', () => {
    expect(ok('"k" in o', { o: { k: 1 } })).toBe(true);
    expect(ok('"z" in o', { o: { k: 1 } })).toBe(false);
    expect(err('1 in o', { o: { k: 1 } })).toBe('type');
    expect(err('1 in null')).toBe('null_operand');
    expect(err('1 in 5')).toBe('type');
    expect(ok('3 in [1, 2]')).toBe(false);
  });

  it('enforces the budget and deep recursion limits', () => {
    expect(err('[' + '1,'.repeat(10_001) + '1]')).toBe('budget');
    expect(err('('.repeat(20_000) + '1' + ')'.repeat(20_000))).toBe('budget');
  });
});

describe('built-in functions (T-50)', () => {
  it('size', () => {
    expect(ok('size("abc")')).toBe(3);
    expect(ok('size([1, 2])')).toBe(2);
    expect(ok('size(o)', { o: { a: 1, b: 2 } })).toBe(2);
    expect(err('size(null)')).toBe('null_operand');
    expect(err('size(1)')).toBe('type');
    expect(err('size()')).toBe('arity');
  });

  it('has, coalesce and if', () => {
    expect(ok('has(x)', { x: 1 })).toBe(true);
    expect(ok('has(x)', {})).toBe(false);
    expect(err('has()')).toBe('arity');
    expect(ok('coalesce(null, null, 3)')).toBe(3);
    expect(ok('coalesce(null)')).toBeNull();
    expect(err('coalesce()')).toBe('arity');
    expect(ok('if(true, 1, 2)')).toBe(1);
    expect(ok('if(false, 1, 2)')).toBe(2);
    expect(err('if(true, 1)')).toBe('arity');
  });

  it('round and abs', () => {
    expect(ok('round(2.5)')).toBe(3);
    expect(ok('round(-2.5)')).toBe(-3);
    expect(ok('round(1.005, 2)')).toBe(1.01);
    expect(ok('round(-0.4)')).toBe(0);
    expect(err('round(1, 1.5)')).toBe('type');
    expect(err('round(1, -1)')).toBe('type');
    expect(err('round(1, 16)')).toBe('type');
    expect(err('round("a")')).toBe('type');
    expect(err('round()')).toBe('arity');
    expect(ok('abs(-3)')).toBe(3);
    expect(err('abs()')).toBe('arity');
    expect(roundHalfAwayFromZero(2.675, 2)).toBe(2.68);
    expect(roundHalfAwayFromZero(7)).toBe(7);
  });

  it('min, max, sum, avg, count', () => {
    expect(ok('min(3, 1, 2)')).toBe(1);
    expect(ok('max(3, 1, 2)')).toBe(3);
    expect(ok('min([4, 2])')).toBe(2);
    expect(ok('max(5)')).toBe(5);
    expect(ok('max([])')).toBeNull();
    expect(err('min()')).toBe('arity');
    expect(err('min(1, "a")')).toBe('type');
    expect(err('min(null)')).toBe('null_operand');
    expect(err('min([1, "a"])')).toBe('type');
    expect(ok('sum([1, 2, 3])')).toBe(6);
    expect(ok('sum([])')).toBe(0);
    expect(err('sum(null)')).toBe('null_operand');
    expect(err('sum(1)')).toBe('type');
    expect(err('sum()')).toBe('arity');
    expect(ok('avg([2, 4])')).toBe(3);
    expect(ok('avg([])')).toBeNull();
    expect(ok('count([1, 2, 3])')).toBe(3);
    expect(err('count(null)')).toBe('null_operand');
    expect(err('count("abc")')).toBe('type');
  });

  it('days_between, add_days and age_days', () => {
    expect(ok('days_between("2026-01-01", "2026-01-31")')).toBe(30);
    expect(ok('add_days("2026-01-31", 1)')).toBe('2026-02-01');
    expect(err('add_days("2026-01-31", 1.5)')).toBe('type');
    expect(err('days_between("2026-01-01", null)')).toBe('null_operand');
    expect(err('days_between("pas-une-date", "2026-01-01")')).toBe('type');
    expect(err('days_between(1, "2026-01-01")')).toBe('type');
    expect(ok('age_days("2026-01-01")', { now: '2026-01-11T10:00:00Z' })).toBe(10);
    expect(err('age_days("2026-01-01")', {})).toBe('null_operand');
    expect(err('age_days("2026-01-01")', { now: 'hier' })).toBe('null_operand');
  });

  it('refuses unknown or non-global callees', () => {
    expect(err('nope(1)')).toBe('unknown_function');
    expect(err('a.b(1)', { a: {} })).toBe('unknown_function');
    expect(isKnownFunction('round')).toBe(true);
    expect(isKnownFunction('nope')).toBe(false);
  });
});

describe('entry points', () => {
  it('evaluateOrThrow returns the value or throws the typed error', () => {
    expect(evaluateOrThrow('1 + 1')).toBe(2);
    expect(() => evaluateOrThrow('1 / 0')).toThrow('division_by_zero');
  });

  it('evaluateCondition treats errors and non-booleans as false', () => {
    expect(evaluateCondition('x > 1', { x: 2 })).toEqual({ value: true });
    expect(evaluateCondition('x', { x: 2 })).toEqual({ value: false });
    expect(evaluateCondition('1 / 0', {})).toEqual({ value: false, error: 'division_by_zero' });
  });
});
