import { ExprError } from './errors';
import { Token, tokenize } from './tokenizer';

export type Node =
  | { t: 'lit'; v: unknown }
  | { t: 'ident'; name: string }
  | { t: 'list'; items: Node[] }
  | { t: 'member'; obj: Node; name: string }
  | { t: 'index'; obj: Node; index: Node }
  | { t: 'call'; callee: Node; args: Node[] }
  | { t: 'unary'; op: '!' | '-'; arg: Node }
  | { t: 'binary'; op: string; left: Node; right: Node }
  | { t: 'ternary'; cond: Node; then: Node; else: Node };

/**
 * Recursive-descent parser following the grammar of EXPRESSIONS.md (lowest → highest precedence):
 * ternary, ||, &&, equality, relation (incl. `in`), additive, multiplicative, unary, postfix, primary.
 */
class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.type === 'op' && t.value === v;
  }
  private isKeyword(v: string): boolean {
    const t = this.peek();
    return t.type === 'ident' && t.value === v;
  }
  private expectOp(v: string): void {
    const t = this.next();
    if (t.type !== 'op' || t.value !== v) {
      throw new ExprError('syntax', `expected '${v}' at ${t.pos}`);
    }
  }

  parseRoot(): Node {
    const node = this.expr();
    if (this.peek().type !== 'eof') throw new ExprError('syntax', `unexpected token at ${this.peek().pos}`);
    return node;
  }

  private expr(): Node {
    return this.ternary();
  }

  private ternary(): Node {
    const cond = this.or();
    if (this.isOp('?')) {
      this.next();
      const thenN = this.expr();
      this.expectOp(':');
      const elseN = this.expr();
      return { t: 'ternary', cond, then: thenN, else: elseN };
    }
    return cond;
  }

  private or(): Node {
    let left = this.and();
    while (this.isOp('||')) {
      this.next();
      left = { t: 'binary', op: '||', left, right: this.and() };
    }
    return left;
  }

  private and(): Node {
    let left = this.equality();
    while (this.isOp('&&')) {
      this.next();
      left = { t: 'binary', op: '&&', left, right: this.equality() };
    }
    return left;
  }

  private equality(): Node {
    let left = this.relation();
    while (this.isOp('==') || this.isOp('!=')) {
      const op = this.next().value;
      left = { t: 'binary', op, left, right: this.relation() };
    }
    return left;
  }

  private relation(): Node {
    let left = this.additive();
    while (this.isOp('<') || this.isOp('<=') || this.isOp('>') || this.isOp('>=') || this.isKeyword('in')) {
      const op = this.next().value;
      left = { t: 'binary', op, left, right: this.additive() };
    }
    return left;
  }

  private additive(): Node {
    let left = this.mult();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value;
      left = { t: 'binary', op, left, right: this.mult() };
    }
    return left;
  }

  private mult(): Node {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = this.next().value;
      left = { t: 'binary', op, left, right: this.unary() };
    }
    return left;
  }

  private unary(): Node {
    if (this.isOp('!') || this.isOp('-')) {
      const op = this.next().value as '!' | '-';
      return { t: 'unary', op, arg: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Node {
    let node = this.primary();
    while (true) {
      if (this.isOp('.')) {
        this.next();
        const id = this.next();
        if (id.type !== 'ident') throw new ExprError('syntax', `expected identifier at ${id.pos}`);
        node = { t: 'member', obj: node, name: id.value };
      } else if (this.isOp('[')) {
        this.next();
        const index = this.expr();
        this.expectOp(']');
        node = { t: 'index', obj: node, index };
      } else if (this.isOp('(')) {
        this.next();
        const args = this.isOp(')') ? [] : this.args();
        this.expectOp(')');
        node = { t: 'call', callee: node, args };
      } else {
        return node;
      }
    }
  }

  private args(): Node[] {
    const out = [this.expr()];
    while (this.isOp(',')) {
      this.next();
      out.push(this.expr());
    }
    return out;
  }

  private primary(): Node {
    const tok = this.next();
    switch (tok.type) {
      case 'num':
        return { t: 'lit', v: tok.num };
      case 'str':
        return { t: 'lit', v: tok.value };
      case 'ident':
        if (tok.value === 'true') return { t: 'lit', v: true };
        if (tok.value === 'false') return { t: 'lit', v: false };
        if (tok.value === 'null') return { t: 'lit', v: null };
        if (tok.value === 'in') throw new ExprError('syntax', `unexpected 'in' at ${tok.pos}`);
        return { t: 'ident', name: tok.value };
      case 'op':
        if (tok.value === '(') {
          const e = this.expr();
          this.expectOp(')');
          return e;
        }
        if (tok.value === '[') {
          const items = this.isOp(']') ? [] : this.args();
          this.expectOp(']');
          return { t: 'list', items };
        }
        throw new ExprError('syntax', `unexpected '${tok.value}' at ${tok.pos}`);
      default:
        throw new ExprError('syntax', `unexpected end of expression`);
    }
  }
}

const cache = new Map<string, Node>();

export function parse(src: string): Node {
  const hit = cache.get(src);
  if (hit) return hit;
  const node = new Parser(tokenize(src)).parseRoot();
  if (cache.size > 2000) cache.clear();
  cache.set(src, node);
  return node;
}

/** Names of functions called in an expression (used by the studio validator). */
export function collectCalls(node: Node, out: Set<string> = new Set()): Set<string> {
  switch (node.t) {
    case 'call':
      if (node.callee.t === 'ident') out.add(node.callee.name);
      node.args.forEach((a) => collectCalls(a, out));
      break;
    case 'list':
      node.items.forEach((a) => collectCalls(a, out));
      break;
    case 'member':
      collectCalls(node.obj, out);
      break;
    case 'index':
      collectCalls(node.obj, out);
      collectCalls(node.index, out);
      break;
    case 'unary':
      collectCalls(node.arg, out);
      break;
    case 'binary':
      collectCalls(node.left, out);
      collectCalls(node.right, out);
      break;
    case 'ternary':
      collectCalls(node.cond, out);
      collectCalls(node.then, out);
      collectCalls(node.else, out);
      break;
    default:
      break;
  }
  return out;
}
