import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SubscriptionVerifyCronService } from '../src/user/subscription-verify-cron.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const svc = app.get(SubscriptionVerifyCronService);
    const userMongoId = '67fc774d7931db01a40cb7ee'; // usuario que compartiste
    console.log(`Verificando suscripción para userMongoId=${userMongoId} ...`);
    const res = await svc.verifyOne({ userMongoId });
    console.log('Resultado:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Error ejecutando verifyOne:', err?.message || err);
    process.exitCode = 2;
  } finally {
    await app.close();
  }
}

main();
