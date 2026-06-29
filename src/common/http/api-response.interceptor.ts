import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { requestId?: string }>();

    return next.handle().pipe(
      map((data) => {
        const requestId = (request as any)?.requestId ?? null;
        const serverTime = new Date().toISOString();

        if (isPlainObject(data)) {
          if (typeof data.success === 'boolean') {
            const currentMeta = isPlainObject(data.meta) ? data.meta : {};

            if (data.success === true) {
              return {
                ...data,
                meta: {
                  ...currentMeta,
                  requestId,
                  serverTime,
                },
              };
            }

            const currentError = isPlainObject(data.error) ? data.error : {};
            const message =
              typeof data.message === 'string' && data.message.trim()
                ? data.message
                : typeof currentError.message === 'string' && currentError.message.trim()
                  ? currentError.message
                  : 'Request failed';

            return {
              ...data,
              error: {
                ...currentError,
                code:
                  typeof currentError.code === 'string' && currentError.code.trim()
                    ? currentError.code
                    : 'REQUEST_FAILED',
                message,
                requestId,
                retryable:
                  typeof currentError.retryable === 'boolean'
                    ? currentError.retryable
                    : false,
              },
              meta: {
                ...currentMeta,
                requestId,
                serverTime,
              },
            };
          }

          return {
            success: true,
            data,
            meta: {
              requestId,
              serverTime,
            },
          };
        }

        return {
          success: true,
          data,
          meta: {
            requestId,
            serverTime,
          },
        };
      }),
    );
  }
}
