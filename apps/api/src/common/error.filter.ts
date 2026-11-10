import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { AppError, ErrorBody, ErrorCode } from './errors';

const BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'VALIDATION_ERROR',
  415: 'VALIDATION_ERROR',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
};

/** Global filter producing `{ error: { code, message, fields?, details? } }` for every failure. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toBody(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    if (res.headersSent) return;
    res.status(status).json(body);
  }

  toBody(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof AppError) {
      return { status: exception.getStatus(), body: exception.getResponse() as ErrorBody };
    }
    if (exception instanceof ThrottlerException) {
      return { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Trop de requêtes, réessayez plus tard' } } };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const r = exception.getResponse() as any;
      const code = BY_STATUS[status] ?? (status >= 500 ? 'SERVER_ERROR' : 'VALIDATION_ERROR');
      let message = typeof r === 'string' ? r : Array.isArray(r?.message) ? r.message.join('; ') : r?.message ?? exception.message;
      if (status === 404 && /Cannot (GET|POST|PUT|PATCH|DELETE)/.test(message)) message = 'Route introuvable';
      if (code === 'VALIDATION_ERROR' && status === 400 && /JSON/i.test(message)) message = 'Corps JSON invalide';
      return { status: status === 400 ? 422 : status, body: { error: { code, message } } };
    }
    if (exception instanceof QueryFailedError) {
      const pg = exception as any;
      if (pg.code === '23505') {
        return { status: 409, body: { error: { code: 'CONFLICT', message: 'Doublon', details: { constraint: pg.constraint } } } };
      }
      if (pg.code === '22P02' || pg.code === '23503' || pg.code === '23514' || pg.code === '22007' || pg.code === '22008') {
        return { status: 422, body: { error: { code: 'VALIDATION_ERROR', message: 'Valeur invalide', details: { db: pg.code } } } };
      }
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: 'SERVER_ERROR', message: 'Erreur interne' } },
    };
  }
}
