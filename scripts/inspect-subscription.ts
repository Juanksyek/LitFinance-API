import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { StripeService } from '../src/stripe/stripe.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const stripeSvc = app.get(StripeService);
    const subId = 'sub_1ShM427qt4C6UN1zB05Q2hlf';
    console.log('Retrieving subscription:', subId);
    const sub = await stripeSvc.stripe.subscriptions.retrieve(subId).catch((e) => { console.error('retrieve err', e?.message); return null; });
    console.log('Subscription:', JSON.stringify(sub ? { id: (sub as any).id, status: (sub as any).status, current_period_end: (sub as any).current_period_end } : null, null, 2));

    const invoices = await stripeSvc.stripe.invoices.list({ subscription: subId, limit: 20 });
    console.log(`Found ${invoices?.data?.length ?? 0} invoices`);
    for (const inv of invoices.data) {
      console.log('--- invoice id=', inv.id, 'status=', inv.status, 'created=', new Date((inv.created||0)*1000).toISOString());
      if (inv.lines && Array.isArray(inv.lines.data)) {
        for (const li of inv.lines.data) {
          console.log('   line:', li.description || li.id, 'period=', JSON.stringify(li.period || null));
        }
      }
    }
  } catch (err) {
    console.error('error', err?.message || err);
  } finally {
    await app.close();
  }
}

main();
