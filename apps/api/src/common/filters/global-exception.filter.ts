// =============================================================================
// GlobalExceptionFilter - normalize all error responses
// =============================================================================
// Without this, unexpected exceptions leak stack traces. With it, every error
// is a consistent JSON shape: { statusCode, error, message, path, timestamp }.
// =============================================================================

import * as Sentry from '@sentry/node';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Backstop for raw Postgres/PostgREST errors that escape a service without
    // being wrapped in an HttpException. 42501 (insufficient_privilege) is what
    // an RLS policy denial raises — that's a real, expected 403, not a 500.
    // Other Postgres error codes still fall through to the generic 500 below.
    const isRlsDenial =
      !(exception instanceof HttpException) &&
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { code?: unknown }).code === '42501';

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : isRlsDenial
        ? HttpStatus.FORBIDDEN
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = exception instanceof HttpException
      ? exception.getResponse()
      : isRlsDenial
        ? { message: 'Not permitted by database policy' }
        : { message: 'Internal server error' };

    const message =
      typeof body === 'string' ? body : (body as Record<string, unknown>).message ?? body;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : exception,
      );
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(exception);
      }
    }

    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
