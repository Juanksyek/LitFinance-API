import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('HttpRequest');

export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const user = (req as any)?.user;
    const requestId = (req as any)?.requestId ?? null;
    const deviceIdHeader = String(req.headers['x-device-id'] ?? '').trim();

    logger.log(
      JSON.stringify({
        requestId,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        userId: user?.id ?? user?.sub ?? null,
        deviceId: deviceIdHeader || null,
        ip: req.ip ?? null,
      }),
    );
  });

  next();
}
