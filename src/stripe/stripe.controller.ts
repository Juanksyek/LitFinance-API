import { Body, Controller, Headers, Post, Req, BadRequestException, UseGuards, Logger } from '@nestjs/common';
import { StripeService } from './stripe.service';
import type { Request } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('stripe')
export class StripeController {
  constructor(
    private readonly stripeSvc: StripeService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  private readonly logger = new Logger(StripeController.name);

  private getAuthUserId(req: any) {
    const id = req.user?.id;
    if (!id) throw new BadRequestException('req.user.id missing');
    return String(id);
  }

  private async findUserByAuthId(authId: string) {
    // 1) intenta por _id si parece ObjectId
    if (Types.ObjectId.isValid(authId)) {
      const byObjectId = await this.userModel.findById(authId);
      if (byObjectId) return byObjectId;
    }

    // 2) intenta por campos alternos
    const byIdField = await this.userModel.findOne({ id: authId });
    if (byIdField) return byIdField;

    const byUserId = await this.userModel.findOne({ userId: authId });
    if (byUserId) return byUserId;

    throw new BadRequestException('User not found in DB for req.user.id');
  }

  private async patchUser(user: any, patch: any) {
    await this.userModel.updateOne({ _id: user._id }, { $set: patch });
  }

  private async findByStripeCustomerId(customerId: string) {
    return this.userModel.findOne({ stripeCustomerId: customerId });
  }

  // -----------------------------
  // WEB — Checkout Subscription
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('web/checkout/subscription')
  async webCheckoutSubscription(@Req() req: any, @Body() body: { priceId: string }) {
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);

    const session = await this.stripeSvc.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: body.priceId, quantity: 1 }],
      client_reference_id: String(user._id),
      metadata: { userMongoId: String(user._id), flow: 'subscription_web' },
      success_url: `${process.env.FRONTEND_WEB_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_WEB_URL}/billing/cancel`,
      customer_email: user.email,
    });

    return { url: session.url };
  }

  // -----------------------------
  // WEB — Checkout TipJar
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('web/checkout/tipjar')
  async webCheckoutTipJar(@Req() req: any, @Body() body: { amountMXN: number }) {
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);

    const session = await this.stripeSvc.stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: String(user._id),
      metadata: { userMongoId: String(user._id), flow: 'tipjar_web' },
      line_items: [
        {
          price_data: {
            currency: 'mxn',
            product_data: { name: 'Apoya con el monto que tú desees ❤️' },
            unit_amount: Math.round(body.amountMXN * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_WEB_URL}/billing/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_WEB_URL}/billing/cancel`,
    });

    return { url: session.url };
  }

  // -----------------------------
  // MOBILE — PaymentSheet Subscription
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('mobile/paymentsheet/subscription')
  async mobilePaymentSheetSubscription(@Req() req: any, @Body() body: { priceId: string }) {
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripeSvc.stripe.customers.create({
        email: user.email,
        metadata: { userMongoId: String(user._id) },
      });
      customerId = customer.id;
      await this.patchUser(user, { stripeCustomerId: customerId });
    }

    const ephemeralKey = await this.stripeSvc.stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: (process.env.STRIPE_API_VERSION as any) || '2024-06-20' },
    );

    const subscription = await this.stripeSvc.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: body.priceId }],
      payment_behavior: 'default_incomplete',
      metadata: { userMongoId: String(user._id), flow: 'subscription_mobile' },
      expand: ['latest_invoice.payment_intent'],
    });

    const paymentIntent = (subscription.latest_invoice as any).payment_intent;

    await this.patchUser(user, { premiumSubscriptionId: subscription.id });

    return {
      customerId,
      ephemeralKeySecret: ephemeralKey.secret,
      paymentIntentClientSecret: paymentIntent.client_secret,
      subscriptionId: subscription.id,
    };
  }

  // -----------------------------
  // MOBILE — PaymentSheet TipJar (monto fijo o libre)
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('mobile/paymentsheet/tipjar')
  async mobilePaymentSheetTipJar(@Req() req: any, @Body() body: { amountMXN: number }) {
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripeSvc.stripe.customers.create({
        email: user.email,
        metadata: { userMongoId: String(user._id) },
      });
      customerId = customer.id;
      await this.patchUser(user, { stripeCustomerId: customerId });
    }

    const ephemeralKey = await this.stripeSvc.stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: (process.env.STRIPE_API_VERSION as any) || '2024-06-20' },
    );

    const paymentIntent = await this.stripeSvc.stripe.paymentIntents.create({
      amount: Math.round(body.amountMXN * 100),
      currency: 'mxn',
      customer: customerId,
      metadata: { userMongoId: String(user._id), flow: 'tipjar_mobile' },
      automatic_payment_methods: { enabled: true },
    });

    return {
      customerId,
      ephemeralKeySecret: ephemeralKey.secret,
      paymentIntentClientSecret: paymentIntent.client_secret,
    };
  }

  // -----------------------------
  // WEBHOOK (confirmación real)
  // -----------------------------
  @Post('webhook')
  async webhook(@Req() req: Request, @Headers('stripe-signature') sig: string) {
    let event: any;

    this.logger.log('--- Stripe Webhook recibido ---');
    this.logger.log('Headers:', JSON.stringify(req.headers));
    try {
      event = this.stripeSvc.stripe.webhooks.constructEvent(
        (req as any).rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!,
      );
      this.logger.log(`Evento recibido: ${event.type}`);
      this.logger.debug(JSON.stringify(event, null, 2));
    } catch (err: any) {
      this.logger.error('Error validando firma de Stripe:', err.message);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      // WEB checkout: jar
      case 'checkout.session.completed': {
        const session: any = event.data.object;
        const userMongoId = session?.metadata?.userMongoId;
        this.logger.log(`[checkout.session.completed] userMongoId: ${userMongoId}`);
        if (session.mode === 'payment' && userMongoId) {
          const amount = (session.amount_total || 0) / 100;
          const days = this.stripeSvc.giftDaysForJar(amount);
          this.logger.log(`[checkout.session.completed] Monto: $${amount} MXN, Días a regalar: ${days}`);
          if (days > 0) {
            const user = await this.userModel.findById(userMongoId);
            if (user) {
              const next = this.stripeSvc.extendPremiumUntil(user.premiumUntil || null, days);
              this.logger.log(`[checkout.session.completed] Actualizando premiumUntil a: ${next}`);
              await this.patchUser(user, { premiumUntil: next });
            } else {
              this.logger.warn(`[checkout.session.completed] Usuario no encontrado: ${userMongoId}`);
            }
          }
        }
        break;
      }

      // MOBILE jar
      case 'payment_intent.succeeded': {
        const pi: any = event.data.object;
        this.logger.log(`[payment_intent.succeeded] metadata: ${JSON.stringify(pi?.metadata)}`);
        if (pi?.metadata?.flow === 'tipjar_mobile') {
          const userMongoId = pi?.metadata?.userMongoId;
          const amount = (pi.amount || 0) / 100;
          const days = this.stripeSvc.giftDaysForJar(amount);
          this.logger.log(`[payment_intent.succeeded] userMongoId: ${userMongoId}, Monto: $${amount} MXN, Días: ${days}`);
          if (days > 0 && userMongoId) {
            const user = await this.userModel.findById(userMongoId);
            if (user) {
              const next = this.stripeSvc.extendPremiumUntil(user.premiumUntil || null, days);
              this.logger.log(`[payment_intent.succeeded] Actualizando premiumUntil a: ${next}`);
              await this.patchUser(user, { premiumUntil: next });
            } else {
              this.logger.warn(`[payment_intent.succeeded] Usuario no encontrado: ${userMongoId}`);
            }
          }
        }
        break;
      }

      // Suscripción confirmada (pago de invoice)
      case 'invoice.paid': {
        const invoice: any = event.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;
        this.logger.log(`[invoice.paid] customerId: ${customerId}, subscriptionId: ${subscriptionId}`);
        const user = await this.findByStripeCustomerId(customerId);
        if (user) {
          this.logger.log(`[invoice.paid] Actualizando premiumSubscriptionId y premiumSubscriptionStatus`);
          await this.patchUser(user, {
            premiumSubscriptionId: subscriptionId,
            premiumSubscriptionStatus: 'active',
          });
        } else {
          this.logger.warn(`[invoice.paid] Usuario no encontrado para customerId: ${customerId}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub: any = event.data.object;
        const customerId = sub.customer;
        this.logger.log(`[customer.subscription.updated] customerId: ${customerId}, subId: ${sub.id}, status: ${sub.status}`);
        const user = await this.findByStripeCustomerId(customerId);
        if (user) {
          this.logger.log(`[customer.subscription.updated] Actualizando premiumSubscriptionId y premiumSubscriptionStatus`);
          await this.patchUser(user, {
            premiumSubscriptionId: sub.id,
            premiumSubscriptionStatus: sub.status,
          });
        } else {
          this.logger.warn(`[customer.subscription.updated] Usuario no encontrado para customerId: ${customerId}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub: any = event.data.object;
        const customerId = sub.customer;
        this.logger.log(`[customer.subscription.deleted] customerId: ${customerId}`);
        const user = await this.findByStripeCustomerId(customerId);
        if (user) {
          this.logger.log(`[customer.subscription.deleted] Actualizando premiumSubscriptionStatus a canceled`);
          await this.patchUser(user, { premiumSubscriptionStatus: 'canceled' });
        } else {
          this.logger.warn(`[customer.subscription.deleted] Usuario no encontrado para customerId: ${customerId}`);
        }
        break;
      }
    }

    return { received: true };
  }
}
