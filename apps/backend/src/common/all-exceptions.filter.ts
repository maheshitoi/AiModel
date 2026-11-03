import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { SystemLogService } from '../logs/system-log.service';

const PRISMA_ERRORS: Record<string, { status: number; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'A record with these values already exists' },
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'A related record does not exist' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Record not found' },
};

/** Renders every error as `{ success: false, error: {...} }` and records server errors. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly systemLog: SystemLogService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const { message: m } = body as { message?: string | string[] };
        if (Array.isArray(m)) {
          message = 'Validation failed';
          details = m;
        } else {
          message = m ?? exception.message;
          details = (body as { details?: unknown }).details;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && PRISMA_ERRORS[exception.code]) {
      ({ status, message } = PRISMA_ERRORS[exception.code]);
      if (exception.code === 'P2002') details = { fields: exception.meta?.target };
    }

    if (status >= 500) {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(`${req.method} ${req.path}: ${error.message}`, error.stack);
      void this.systemLog.error('BACKEND', 'http.unhandled_error', error.message, {
        method: req.method,
        path: req.path,
      });
    }

    res.status(status).json({
      success: false,
      error: { statusCode: status, message, details, path: req.path, timestamp: new Date().toISOString() },
    });
  }
}
