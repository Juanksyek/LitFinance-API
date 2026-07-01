import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

type ExceptionPayload = {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  code?: string;
  details?: unknown;
  retryAfterSeconds?: number;
};

function looksSensitiveMessage(message: string): boolean {
  return /(E11000|Mongo|Mongoose|duplicate key|Cast to ObjectId|BSON|Validation failed)/i.test(
    message,
  );
}

function normalizeCode(status: number, payload?: ExceptionPayload): string {
  if (payload?.code && typeof payload.code === 'string') {
    return payload.code;
  }

  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED';
  }
}

function normalizeMessage(payload?: ExceptionPayload, fallback = 'Unexpected error') {
  if (Array.isArray(payload?.message)) {
    return payload.message.join(', ');
  }

  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error;
  }

  return fallback;
}

function sanitizeMessage(status: number, message: string, code: string) {
  if (status >= 500) {
    return 'Internal server error';
  }

  if (looksSensitiveMessage(message)) {
    switch (code) {
      case 'CONFLICT':
        return 'El recurso ya existe o entra en conflicto con otro registro.';
      case 'BAD_REQUEST':
        return 'La solicitud contiene datos inválidos.';
      default:
        return 'La solicitud no pudo procesarse.';
    }
  }

  return message;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string; user?: { id?: string } }>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawPayload = isHttpException
      ? (exception.getResponse() as string | ExceptionPayload)
      : null;

    const payload =
      rawPayload && typeof rawPayload === 'object'
        ? rawPayload
        : { message: typeof rawPayload === 'string' ? rawPayload : undefined };

    const code = normalizeCode(status, payload);
    const rawMessage = normalizeMessage(
      payload,
      status >= 500 ? 'Internal server error' : 'Request failed',
    );
    const message = sanitizeMessage(status, rawMessage, code);
    const retryable = status === HttpStatus.TOO_MANY_REQUESTS || status >= 500;
    const requestId = (request as any)?.requestId ?? null;
    const retryAfterSeconds =
      typeof payload?.retryAfterSeconds === 'number'
        ? payload.retryAfterSeconds
        : typeof (payload?.details as any)?.retryAfterSeconds === 'number'
          ? (payload?.details as any).retryAfterSeconds
          : undefined;

    if (status >= 500) {
      const err = exception as any;
      this.logger.error(
        JSON.stringify({
          requestId,
          method: request.method,
          path: request.url,
          userId: request?.user?.id ?? null,
          statusCode: status,
          code,
          message,
          stack:
            process.env.NODE_ENV === 'production'
              ? undefined
              : (err?.stack ?? String(exception)),
        }),
      );
    }

    if (retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        requestId,
        retryable,
        details: status < 500 ? payload?.details ?? undefined : undefined,
      },
      meta: {
        requestId,
        serverTime: new Date().toISOString(),
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      },
      path: request.url,
    });
  }
}
