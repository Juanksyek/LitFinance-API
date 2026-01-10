import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const { StripeService } = await import('../src/stripe/stripe.service');
    const stripeSvc = app.get(StripeService as any) as any;
    const subId = process.argv[2] || 'sub_1ShM427qt4C6UN1zB05Q2hlf';
    console.log('Inspecting subscription', subId);

    const sub = await stripeSvc.stripe.subscriptions.retrieve(subId);
    console.log('Subscription:', JSON.stringify(sub, null, 2));

    const invoices = await stripeSvc.stripe.invoices.list({ subscription: subId, limit: 20 });
    console.log('Invoices count:', invoices.data.length);
    for (const inv of invoices.data) {
      console.log('--- invoice ---');
      console.log('id:', inv.id, 'status:', inv.status, 'created:', new Date((inv.created || 0) * 1000).toISOString());
      if (inv.lines && Array.isArray(inv.lines.data)) {
        for (const li of inv.lines.data) {
          console.log('line:', li.id, 'desc:', li.description || li.plan?.nickname || li.plan?.id, 'amount:', li.amount || li.price?.unit_amount, 'period:', li?.period);
        }
      }
    }

  } catch (err: any) {
    console.error('Error inspecting subscription:', err?.message || err);
  } finally {
    await app.close();
  }
}

main();
