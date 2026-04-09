import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import { PlanConfigService } from './plan-config/plan-config.service';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';

  // IMPORTANT: Stripe webhook signature verification requires the raw body.
  // Nest's default body parser would consume it before we can validate the signature.
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    // Keep debug/verbose off in prod to save RAM, but keep log+warn+error always on
    logger: isProd
      ? ['log', 'error', 'warn']
      : ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
      // Always show which field fails — critical for diagnosing 400s in production
      disableErrorMessages: false,
    }),
  );

  // Inicializar planes por defecto
  const planConfigService = app.get(PlanConfigService);
  await planConfigService.initializeDefaults();
  console.log('✅ Planes por defecto inicializados (free_plan y premium_plan)');

  // 1) Webhook: raw SIEMPRE (Stripe manda application/json; charset=utf-8)
  app.use('/stripe/webhook', bodyParser.raw({ type: 'application/json' }));

  // 2) Parsers normales para TODO MENOS el webhook
  // 10mb to accommodate base64-encoded ticket images (~7MB photo → ~9.5MB base64)
  const jsonParser = bodyParser.json({ limit: '10mb' });
  const urlParser = bodyParser.urlencoded({ extended: true, limit: '10mb' });

  app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/stripe/webhook')) return next();
    return jsonParser(req, res, next);
  });

  app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/stripe/webhook')) return next();
    return urlParser(req, res, next);
  });

  app.enableCors({
    origin: (origin, callback) => {
      // Dominios web permitidos
      const allowedOrigins = [
        'http://localhost:5173',
        'https://thelitfinance.com',
        'https://www.thelitfinance.com'
      ];
      
      
      // Esquemas de apps móviles comunes
      const mobileSchemes = [
        'capacitor://',
        'ionic://',
        'file://',
        'http://localhost',
        'http://127.0.0.1'
      ];
      
      // Si no hay origin (apps móviles nativas), permitir
      if (!origin) {
        callback(null, true);
        return;
      }
      
      // Si es un dominio web permitido
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      
      // Si es un esquema de app móvil
      if (mobileSchemes.some(scheme => origin.startsWith(scheme))) {
        callback(null, true);
        return;
      }
      
      // Rechazar otros orígenes
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    exposedHeaders: ['Authorization', 'x-access-token', 'x-refresh-token', 'x-session-refreshed'],
    maxAge: 86400, // 24 horas de cache para preflight
  });

  await app.listen(process.env.PORT || 3001, '0.0.0.0');
}
bootstrap();
