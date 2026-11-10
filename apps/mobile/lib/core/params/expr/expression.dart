// Pure Dart — no Flutter imports.
// Public facade of the RecallFarm expression language (CEL subset, MVP).
import 'ast.dart';
import 'errors.dart';
import 'evaluator.dart';
import 'parser.dart';

export 'errors.dart' show ExprError;
export 'evaluator.dart' show deepEquals, formatDate, parseDateLoose, roundHalfUp;

class ExprResult {
  const ExprResult.ok(this.value)
      : ok = true,
        error = null;
  const ExprResult.err(this.error)
      : ok = false,
        value = null;

  final bool ok;
  final Object? value;
  final String? error;

  /// Convenience: `true` only for a successful boolean `true`.
  bool get isTrue => ok && value == true;

  @override
  String toString() => ok ? 'ok($value)' : 'error($error)';
}

class CompiledExpression {
  CompiledExpression._(this.source, this._node, this._syntaxError);

  final String source;
  final Node? _node;
  final String? _syntaxError;

  ExprResult evaluate(Map<String, Object?> context, {int budget = kExprBudget}) {
    if (_node == null) return ExprResult.err(_syntaxError ?? 'syntax');
    try {
      final v = Evaluator(context, budget: budget).eval(_node);
      return ExprResult.ok(v);
    } on ExprError catch (e) {
      return ExprResult.err(e.code);
    } on StackOverflowError {
      return const ExprResult.err('budget');
    }
  }
}

class Expressions {
  Expressions._();

  static final Map<String, CompiledExpression> _cache = <String, CompiledExpression>{};

  static CompiledExpression compile(String source) {
    final cached = _cache[source];
    if (cached != null) return cached;
    CompiledExpression compiled;
    try {
      compiled = CompiledExpression._(source, Parser.parse(source), null);
    } on ExprError catch (e) {
      compiled = CompiledExpression._(source, null, e.code);
    } on FormatException {
      compiled = CompiledExpression._(source, null, 'syntax');
    }
    if (_cache.length > 512) _cache.clear();
    _cache[source] = compiled;
    return compiled;
  }

  /// Evaluates [source] against [context]. Never throws.
  static ExprResult evaluate(String source, Map<String, Object?> context) =>
      compile(source).evaluate(context);
}
