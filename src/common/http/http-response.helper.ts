import { HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

type SuccessMeta = Record<string, unknown>;

type ErrorPayload = {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
  path?: string;
  statusCode?: number;
  retryAfterSeconds?: number;
};

function getRequestId(req: Request) {
  return (req as any)?.requestId ?? null;
}

export function buildSuccessResponse(
  req: Request,
  data: unknown,
  meta: SuccessMeta = {},
) {
  return {
    success: true,
    data,
    meta: {
      ...meta,
      requestId: getRequestId(req),
      serverTime: new Date().toISOString(),
    },
  };
}

export function sendSuccessResponse(
  req: Request,
  res: Response,
  data: unknown,
  meta: SuccessMeta = {},
  status = HttpStatus.OK,
) {
  return res.status(status).json(buildSuccessResponse(req, data, meta));
}

export function buildErrorResponse(req: Request, error: ErrorPayload) {
  const requestId = getRequestId(req);

  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      requestId,
      retryable: error.retryable,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
    meta: {
      requestId,
      serverTime: new Date().toISOString(),
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    },
    ...(error.path ? { path: error.path } : {}),
  };
}

export function sendErrorResponse(
  req: Request,
  res: Response,
  error: ErrorPayload,
) {
  if (error.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(error.retryAfterSeconds));
  }

  return res
    .status(error.statusCode ?? HttpStatus.BAD_REQUEST)
    .json(buildErrorResponse(req, error));
}
