import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incomingRequestId = String(req.headers['x-request-id'] ?? '').trim();
  const requestId = incomingRequestId || randomUUID();

  (req as any).requestId = requestId;
  res.setHeader('x-request-id', requestId);

  next();
}
