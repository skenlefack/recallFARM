/** Error codes of the RecallFarm expression language (EXPRESSIONS.md §Résultat). */
export type ExprErrorCode =
  | 'syntax'
  | 'unknown_function'
  | 'type'
  | 'null_operand'
  | 'division_by_zero'
  | 'budget'
  | 'arity';

export class ExprError extends Error {
  constructor(
    public readonly code: ExprErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ExprError';
  }
}
