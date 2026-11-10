// Pure Dart — no Flutter imports. Grammar: packages/params/EXPRESSIONS.md
import 'ast.dart';
import 'errors.dart';
import 'lexer.dart';

class Parser {
  Parser(String src) : _tokens = tokenize(src);

  final List<Token> _tokens;
  int _pos = 0;

  static Node parse(String src) {
    final p = Parser(src);
    final node = p._expr();
    if (p._peek.kind != TokKind.eof) throw const ExprError('syntax');
    return node;
  }

  Token get _peek => _tokens[_pos];

  Token _next() {
    final t = _tokens[_pos];
    if (_pos < _tokens.length - 1) _pos++;
    return t;
  }

  void _expectOp(String op) {
    if (!_peek.isOp(op)) throw const ExprError('syntax');
    _next();
  }

  Node _expr() => _ternary();

  Node _ternary() {
    final cond = _or();
    if (_peek.isOp('?')) {
      _next();
      final a = _expr();
      _expectOp(':');
      final b = _expr();
      return TernaryNode(cond, a, b);
    }
    return cond;
  }

  Node _or() {
    var left = _and();
    while (_peek.isOp('||')) {
      _next();
      left = BinaryNode('||', left, _and());
    }
    return left;
  }

  Node _and() {
    var left = _equality();
    while (_peek.isOp('&&')) {
      _next();
      left = BinaryNode('&&', left, _equality());
    }
    return left;
  }

  Node _equality() {
    var left = _relation();
    while (_peek.isOp('==') || _peek.isOp('!=')) {
      final op = _next().text;
      left = BinaryNode(op, left, _relation());
    }
    return left;
  }

  Node _relation() {
    var left = _additive();
    while (true) {
      final t = _peek;
      if (t.isOp('<') || t.isOp('<=') || t.isOp('>') || t.isOp('>=')) {
        _next();
        left = BinaryNode(t.text, left, _additive());
      } else if (t.isIdent('in')) {
        _next();
        left = BinaryNode('in', left, _additive());
      } else {
        break;
      }
    }
    return left;
  }

  Node _additive() {
    var left = _mult();
    while (_peek.isOp('+') || _peek.isOp('-')) {
      final op = _next().text;
      left = BinaryNode(op, left, _mult());
    }
    return left;
  }

  Node _mult() {
    var left = _unary();
    while (_peek.isOp('*') || _peek.isOp('/') || _peek.isOp('%')) {
      final op = _next().text;
      left = BinaryNode(op, left, _unary());
    }
    return left;
  }

  Node _unary() {
    if (_peek.isOp('!') || _peek.isOp('-')) {
      final op = _next().text;
      return UnaryNode(op, _unary());
    }
    return _postfix();
  }

  Node _postfix() {
    var node = _primary();
    while (true) {
      if (_peek.isOp('.')) {
        _next();
        final t = _next();
        if (t.kind != TokKind.ident) throw const ExprError('syntax');
        node = MemberNode(node, t.text);
      } else if (_peek.isOp('[')) {
        _next();
        final idx = _expr();
        _expectOp(']');
        node = IndexNode(node, idx);
      } else if (_peek.isOp('(')) {
        // Only bare identifiers are callable (functions of the contract).
        if (node is! IdentNode) throw const ExprError('syntax');
        _next();
        final args = _args(')');
        node = CallNode(node.name, args);
      } else {
        break;
      }
    }
    return node;
  }

  List<Node> _args(String closing) {
    final args = <Node>[];
    if (_peek.isOp(closing)) {
      _next();
      return args;
    }
    args.add(_expr());
    while (_peek.isOp(',')) {
      _next();
      args.add(_expr());
    }
    _expectOp(closing);
    return args;
  }

  Node _primary() {
    final t = _next();
    switch (t.kind) {
      case TokKind.number:
        return LiteralNode(t.number);
      case TokKind.string:
        return LiteralNode(t.text);
      case TokKind.ident:
        switch (t.text) {
          case 'true':
            return const LiteralNode(true);
          case 'false':
            return const LiteralNode(false);
          case 'null':
            return const LiteralNode(null);
          case 'in':
            throw const ExprError('syntax');
          default:
            return IdentNode(t.text);
        }
      case TokKind.op:
        if (t.text == '(') {
          final e = _expr();
          _expectOp(')');
          return e;
        }
        if (t.text == '[') {
          return ListNode(_args(']'));
        }
        throw const ExprError('syntax');
      case TokKind.eof:
        throw const ExprError('syntax');
    }
  }
}
