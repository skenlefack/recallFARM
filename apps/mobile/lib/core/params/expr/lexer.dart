// Pure Dart — no Flutter imports. Contract: packages/params/EXPRESSIONS.md
import 'errors.dart';

enum TokKind { number, string, ident, op, eof }

class Token {
  const Token(this.kind, this.text, this.pos, [this.number]);
  final TokKind kind;
  final String text;
  final int pos;
  final double? number;

  bool isOp(String op) => kind == TokKind.op && text == op;
  bool isIdent(String name) => kind == TokKind.ident && text == name;

  @override
  String toString() => '$kind($text)@$pos';
}

const _twoCharOps = <String>{'==', '!=', '<=', '>=', '&&', '||'};
const _oneCharOps = <String>{
  '(', ')', '[', ']', ',', '.', '?', ':', '+', '-', '*', '/', '%', '!', '<', '>'
};

bool _isDigit(int c) => c >= 0x30 && c <= 0x39;
bool _isIdentStart(int c) =>
    (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c == 0x5F;
bool _isIdentPart(int c) => _isIdentStart(c) || _isDigit(c);

List<Token> tokenize(String src) {
  final tokens = <Token>[];
  var i = 0;
  final n = src.length;
  while (i < n) {
    final c = src.codeUnitAt(i);
    // whitespace
    if (c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D) {
      i++;
      continue;
    }
    if (_isDigit(c)) {
      final start = i;
      while (i < n && _isDigit(src.codeUnitAt(i))) {
        i++;
      }
      if (i < n && src.codeUnitAt(i) == 0x2E /* . */ &&
          i + 1 < n && _isDigit(src.codeUnitAt(i + 1))) {
        i++;
        while (i < n && _isDigit(src.codeUnitAt(i))) {
          i++;
        }
      }
      final text = src.substring(start, i);
      tokens.add(Token(TokKind.number, text, start, double.parse(text)));
      continue;
    }
    if (_isIdentStart(c)) {
      final start = i;
      while (i < n && _isIdentPart(src.codeUnitAt(i))) {
        i++;
      }
      tokens.add(Token(TokKind.ident, src.substring(start, i), start));
      continue;
    }
    if (c == 0x27 /* ' */ || c == 0x22 /* " */) {
      final quote = c;
      final start = i;
      i++;
      final sb = StringBuffer();
      var closed = false;
      while (i < n) {
        final ch = src.codeUnitAt(i);
        if (ch == quote) {
          closed = true;
          i++;
          break;
        }
        if (ch == 0x5C /* \ */) {
          if (i + 1 >= n) throw const ExprError('syntax');
          final esc = src[i + 1];
          switch (esc) {
            case '\\':
              sb.write('\\');
              break;
            case "'":
              sb.write("'");
              break;
            case '"':
              sb.write('"');
              break;
            case 'n':
              sb.write('\n');
              break;
            default:
              throw const ExprError('syntax');
          }
          i += 2;
          continue;
        }
        sb.writeCharCode(ch);
        i++;
      }
      if (!closed) throw const ExprError('syntax');
      tokens.add(Token(TokKind.string, sb.toString(), start));
      continue;
    }
    if (i + 1 < n) {
      final two = src.substring(i, i + 2);
      if (_twoCharOps.contains(two)) {
        tokens.add(Token(TokKind.op, two, i));
        i += 2;
        continue;
      }
    }
    final one = src[i];
    if (_oneCharOps.contains(one)) {
      tokens.add(Token(TokKind.op, one, i));
      i++;
      continue;
    }
    throw const ExprError('syntax');
  }
  tokens.add(Token(TokKind.eof, '', n));
  return tokens;
}
