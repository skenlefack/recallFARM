// Pure Dart — no Flutter imports.

/// Error codes of the shared expression contract (EXPRESSIONS.md):
/// syntax, unknown_function, type, null_operand, division_by_zero, budget, arity.
class ExprError implements Exception {
  const ExprError(this.code, [this.detail]);
  final String code;
  final String? detail;

  @override
  String toString() => detail == null ? 'ExprError($code)' : 'ExprError($code: $detail)';
}
