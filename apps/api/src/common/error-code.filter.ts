import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR_CODE_HEADER, REQUEST_ID_HEADER } from '@resget/shared';
import { errorCodeOf } from './api-error';

/**
 * Turns every exception into a stable JSON body, echoes the request id and
 * exposes the error code as a header. Unknown errors never leak their message.
 */
@Catch()
export class ErrorCodeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorCodeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = req.headers[REQUEST_ID_HEADER];
    if (typeof requestId === 'string') res.setHeader(REQUEST_ID_HEADER, requestId);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = errorCodeOf(exception) ?? defaultCodeFor(status);
      res.setHeader(ERROR_CODE_HEADER, code);
      const body = exception.getResponse();
      res
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, code, message: body } : { code, ...body });
      return;
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.setHeader(ERROR_CODE_HEADER, 'INTERNAL');
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ statusCode: 500, code: 'INTERNAL', message: 'Internal server error' });
  }
}

function defaultCodeFor(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'ERROR';
  }
}
