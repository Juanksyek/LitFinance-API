import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SubscriptionVerifyCronService } from '../src/user/subscription-verify-cron.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const svc = app.get(SubscriptionVerifyCronService);
    console.log('Invocando verifySubscriptions()...');
    const res = await svc.verifySubscriptions();
    console.log('verifySubscriptions() finalizó.');
  } catch (err) {
    console.error('Error ejecutando verifySubscriptions:', err);
    process.exitCode = 2;
  } finally {
    await app.close();
  }
}

main();
