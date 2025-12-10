import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
    exposedHeaders: ['Authorization'],
    maxAge: 86400, // 24 horas de cache para preflight
  });

  await app.listen(process.env.PORT || 3001, '0.0.0.0');
}
bootstrap();
