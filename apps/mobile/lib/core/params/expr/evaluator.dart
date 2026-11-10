// Pure Dart — no Flutter imports. Semantics: packages/params/EXPRESSIONS.md
import 'ast.dart';
import 'errors.dart';

const int kExprBudget = 10000;

class Evaluator {
  Evaluator(this.context, {this.budget = kExprBudget});

  final Map<String, Object?> context;
  final int budget;
  int _ops = 0;

  Object? eval(Node node) {
    _ops++;
    if (_ops > budget) throw const ExprError('budget');
    switch (node) {
      case LiteralNode(:final value):
        return value;
      case IdentNode(:final name):
        return context[name];
      case ListNode(:final items):
        return [for (final i in items) eval(i)];
      case MemberNode(:final target, :final name):
        return _member(eval(target), name);
      case IndexNode(:final target, :final index):
        return _index(eval(target), eval(index));
      case CallNode(:final name, :final args):
        return _call(name, args);
      case UnaryNode(:final op, :final operand):
        return _unary(op, eval(operand));
      case BinaryNode(:final op, :final left, :final right):
        return _binary(op, left, right);
      case TernaryNode(:final cond, :final then, :final otherwise):
        final c = eval(cond);
        if (c is! bool) throw const ExprError('type');
        return c ? eval(then) : eval(otherwise);
    }
  }

  // ---------------------------------------------------------------- access

  Object? _member(Object? target, String name) {
    if (target == null) return null;
    if (target is Map) return target[name];
    throw const ExprError('type');
  }

  Object? _index(Object? target, Object? index) {
    if (target == null) return null;
    if (target is List) {
      if (index == null) throw const ExprError('null_operand');
      if (index is! num) throw const ExprError('type');
      final d = index.toDouble();
      if (d != d.truncateToDouble()) throw const ExprError('type');
      final i = d.toInt();
      if (i < 0 || i >= target.length) return null;
      return target[i];
    }
    if (target is Map) {
      if (index is! String) throw const ExprError('type');
      return target[index];
    }
    throw const ExprError('type');
  }

  // ---------------------------------------------------------------- operators

  Object? _unary(String op, Object? v) {
    if (op == '!') {
      if (v is bool) return !v;
      throw const ExprError('type');
    }
    // '-'
    if (v == null) throw const ExprError('null_operand');
    if (v is num) return -v.toDouble();
    throw const ExprError('type');
  }

  Object? _binary(String op, Node leftNode, Node rightNode) {
    if (op == '&&' || op == '||') {
      final l = eval(leftNode);
      if (l is! bool) throw const ExprError('type');
      if (op == '&&' && !l) return false;
      if (op == '||' && l) return true;
      final r = eval(rightNode);
      if (r is! bool) throw const ExprError('type');
      return r;
    }
    final l = eval(leftNode);
    final r = eval(rightNode);
    switch (op) {
      case '==':
        return deepEquals(l, r);
      case '!=':
        return !deepEquals(l, r);
      case 'in':
        if (r == null) throw const ExprError('null_operand');
        if (r is List) return r.any((e) => deepEquals(e, l));
        if (r is Map) {
          if (l is! String) throw const ExprError('type');
          return r.containsKey(l);
        }
        throw const ExprError('type');
      case '<':
      case '<=':
      case '>':
      case '>=':
        if (l == null || r == null) throw const ExprError('null_operand');
        final int cmp;
        if (l is num && r is num) {
          cmp = l.toDouble().compareTo(r.toDouble());
        } else if (l is String && r is String) {
          cmp = l.compareTo(r);
        } else {
          throw const ExprError('type');
        }
        switch (op) {
          case '<':
            return cmp < 0;
          case '<=':
            return cmp <= 0;
          case '>':
            return cmp > 0;
          default:
            return cmp >= 0;
        }
      case '+':
        if (l == null || r == null) throw const ExprError('null_operand');
        if (l is num && r is num) return l.toDouble() + r.toDouble();
        if (l is String && r is String) return l + r;
        throw const ExprError('type');
      case '-':
      case '*':
      case '/':
      case '%':
        if (l == null || r == null) throw const ExprError('null_operand');
        if (l is! num || r is! num) throw const ExprError('type');
        final a = l.toDouble();
        final b = r.toDouble();
        switch (op) {
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            if (b == 0) throw const ExprError('division_by_zero');
            return a / b;
          default:
            if (b == 0) throw const ExprError('division_by_zero');
            // Truncated remainder (same sign as dividend), like JS `%`.
            return a.remainder(b);
        }
    }
    throw const ExprError('syntax');
  }

  // ---------------------------------------------------------------- functions

  static const Map<String, List<int>> _arity = {
    // name: [min, max] (max -1 = unbounded)
    'size': [1, 1],
    'has': [1, 1],
    'coalesce': [1, -1],
    'if': [3, 3],
    'round': [1, 2],
    'abs': [1, 1],
    'min': [1, -1],
    'max': [1, -1],
    'sum': [1, 1],
    'avg': [1, 1],
    'count': [1, 1],
    'days_between': [2, 2],
    'add_days': [2, 2],
    'age_days': [1, 1],
  };

  Object? _call(String name, List<Node> args) {
    final ar = _arity[name];
    if (ar == null) throw const ExprError('unknown_function');
    if (args.length < ar[0] || (ar[1] >= 0 && args.length > ar[1])) {
      throw const ExprError('arity');
    }
    switch (name) {
      case 'has':
        return eval(args[0]) != null;
      case 'coalesce':
        {
          for (final a in args) {
            final v = eval(a);
            if (v != null) return v;
          }
          return null;
        }
      case 'if':
        {
          final c = eval(args[0]);
          if (c is! bool) throw const ExprError('type');
          return c ? eval(args[1]) : eval(args[2]);
        }
      case 'size':
        {
          final v = eval(args[0]);
          if (v == null) throw const ExprError('null_operand');
          if (v is String) return v.length.toDouble();
          if (v is List) return v.length.toDouble();
          if (v is Map) return v.length.toDouble();
          throw const ExprError('type');
        }
      case 'round':
        {
          final x = _num(eval(args[0]));
          var digits = 0;
          if (args.length == 2) {
            final d = _num(eval(args[1]));
            if (d != d.truncateToDouble() || d < 0) throw const ExprError('type');
            digits = d.toInt();
          }
          return roundHalfUp(x, digits);
        }
      case 'abs':
        return _num(eval(args[0])).abs();
      case 'min':
      case 'max':
        {
          final values = _numbersFromArgs(args);
          if (values.isEmpty) return null;
          var best = values.first;
          for (final v in values.skip(1)) {
            if (name == 'min' ? v < best : v > best) best = v;
          }
          return best;
        }
      case 'sum':
        return _numList(eval(args[0])).fold<double>(0, (a, b) => a + b);
      case 'avg':
        {
          final list = _numList(eval(args[0]));
          if (list.isEmpty) return null;
          return list.fold<double>(0, (a, b) => a + b) / list.length;
        }
      case 'count':
        {
          final v = eval(args[0]);
          if (v == null) throw const ExprError('null_operand');
          if (v is List) return v.length.toDouble();
          throw const ExprError('type');
        }
      case 'days_between':
        {
          final a = _date(eval(args[0]));
          final b = _date(eval(args[1]));
          return b.difference(a).inDays.toDouble();
        }
      case 'add_days':
        {
          final d = _date(eval(args[0]));
          final n = _num(eval(args[1]));
          if (n != n.truncateToDouble()) throw const ExprError('type');
          return formatDate(DateTime.utc(d.year, d.month, d.day + n.toInt()));
        }
      case 'age_days':
        {
          final d = _date(eval(args[0]));
          final nowRaw = context['now'];
          final now = nowRaw == null ? _today() : _date(nowRaw);
          return now.difference(d).inDays.toDouble();
        }
    }
    throw const ExprError('unknown_function');
  }

  double _num(Object? v) {
    if (v == null) throw const ExprError('null_operand');
    if (v is num) return v.toDouble();
    throw const ExprError('type');
  }

  List<double> _numList(Object? v) {
    if (v == null) throw const ExprError('null_operand');
    if (v is! List) throw const ExprError('type');
    return [for (final e in v) _num(e)];
  }

  List<double> _numbersFromArgs(List<Node> args) {
    if (args.length == 1) {
      final v = eval(args[0]);
      if (v is List) return _numList(v);
      return [_num(v)];
    }
    return [for (final a in args) _num(eval(a))];
  }

  static DateTime _today() {
    final n = DateTime.now();
    return DateTime.utc(n.year, n.month, n.day);
  }

  static DateTime _date(Object? v) {
    if (v == null) throw const ExprError('null_operand');
    if (v is! String) throw const ExprError('type');
    final d = parseDateLoose(v);
    if (d == null) throw const ExprError('type');
    return d;
  }
}

// ------------------------------------------------------------------ helpers

final RegExp _ymd = RegExp(r'^(\d{4})-(\d{2})-(\d{2})');

/// Parses `YYYY-MM-DD` or an ISO timestamp; returns the calendar date at UTC midnight.
/// For timestamps carrying an offset/`Z`, the UTC calendar date is used.
DateTime? parseDateLoose(String s) {
  if (s.length > 10) {
    final dt = DateTime.tryParse(s);
    if (dt == null) return null;
    // DateTime.tryParse returns a UTC value when the string carries `Z` or an offset.
    return DateTime.utc(dt.year, dt.month, dt.day);
  }
  final m = _ymd.firstMatch(s);
  if (m == null) return null;
  final y = int.parse(m.group(1)!);
  final mo = int.parse(m.group(2)!);
  final d = int.parse(m.group(3)!);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return DateTime.utc(y, mo, d);
}

String formatDate(DateTime d) {
  String two(int v) => v.toString().padLeft(2, '0');
  return '${d.year.toString().padLeft(4, '0')}-${two(d.month)}-${two(d.day)}';
}

/// Round half up (away from zero) with `digits` decimals.
/// Values are first normalised to 15 significant digits to absorb binary noise,
/// e.g. `1.005 * 1000 = 1004.9999999999999` rounds to `1005` (shared vector).
double roundHalfUp(double x, int digits) {
  if (x.isNaN || x.isInfinite) return x;
  double clean(double v) => v == 0 ? 0 : double.parse(v.toStringAsPrecision(15));
  final factor = _pow10(digits);
  final scaled = clean(clean(x) * factor);
  final sign = scaled < 0 ? -1.0 : 1.0;
  final a = scaled.abs();
  final fl = a.floorToDouble();
  final r = (a - fl) >= 0.5 ? fl + 1 : fl;
  final result = sign * r / factor;
  return result == 0 ? 0.0 : result;
}

double _pow10(int n) {
  var f = 1.0;
  for (var i = 0; i < n; i++) {
    f *= 10;
  }
  return f;
}

/// Deep equality: numbers compared numerically, lists element-wise, maps key-wise.
bool deepEquals(Object? a, Object? b) {
  if (a == null || b == null) return a == null && b == null;
  if (a is num && b is num) return a.toDouble() == b.toDouble();
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!deepEquals(a[i], b[i])) return false;
    }
    return true;
  }
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final k in a.keys) {
      if (!b.containsKey(k) || !deepEquals(a[k], b[k])) return false;
    }
    return true;
  }
  return a == b;
}
