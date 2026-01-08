import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { StripeService } from '../src/stripe/stripe.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const stripeSvc = app.get(StripeService);
    const subId = 'sub_1ShM427qt4C6UN1zB05Q2hlf';
    console.log('Calling resolveSubscriptionPeriodEnd for', subId);
    const period = await stripeSvc.resolveSubscriptionPeriodEnd(subId);
    console.log('Resolved period:', period);
  } catch (err) {
    console.error('err', err?.message || err);
  } finally {
    await app.close();
  }
}

main();
