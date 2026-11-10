import { HttpException } from '@nestjs/common';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'PLAN_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'BUSINESS_RULE'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  PLAN_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
  BUSINESS_RULE: 422,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
};

export interface ErrorBody {
  error: { code: ErrorCode; message: string; fields?: Record<string, string>; details?: Record<string, unknown> };
}

/** Application error rendered in the uniform format of 05 §Conventions. */
export class AppError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly extra: { fields?: Record<string, string>; details?: Record<string, unknown> } = {},
  ) {
    super({ error: { code, message, ...extra } } satisfies ErrorBody, STATUS[code]);
  }
}

export const Errors = {
  unauthenticated: (m = 'Authentification requise') => new AppError('UNAUTHENTICATED', m),
  forbidden: (m = 'Accès refusé') => new AppError('FORBIDDEN', m),
  notFound: (what = 'Ressource') => new AppError('NOT_FOUND', `${what} introuvable`),
  conflict: (m: string, details?: Record<string, unknown>) => new AppError('CONFLICT', m, { details }),
  validation: (fields: Record<string, string>, m = 'Champs invalides') => new AppError('VALIDATION_ERROR', m, { fields }),
  business: (rule: string, m: string, details: Record<string, unknown> = {}) =>
    new AppError('BUSINESS_RULE', m, { details: { rule, ...details } }),
  planRequired: (requiredPlan: string, feature: string) =>
    new AppError('PLAN_REQUIRED', `Fonction réservée à la formule ${requiredPlan}`, { details: { required_plan: requiredPlan, feature } }),
  quota: (m: string, details?: Record<string, unknown>) => new AppError('QUOTA_EXCEEDED', m, { details }),
  rateLimited: (retryAfterS: number) =>
    new AppError('RATE_LIMITED', 'Trop de requêtes, réessayez plus tard', { details: { retry_after_s: retryAfterS } }),
};
