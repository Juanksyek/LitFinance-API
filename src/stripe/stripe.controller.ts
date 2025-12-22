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
  // MOBILE — PaymentSheet SetupIntent (para guardar método de pago)
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('mobile/paymentsheet/setup-intent')
  async mobilePaymentSheetSetupIntent(@Req() req: any) {
    this.logger.log('=== INICIO mobilePaymentSheetSetupIntent ===');
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);
    this.logger.log(`Usuario: ${user._id}, email: ${user.email}, stripeCustomerId: ${user.stripeCustomerId || 'null'}`);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      this.logger.log('Creando nuevo Stripe customer...');
      const customer = await this.stripeSvc.stripe.customers.create({
        email: user.email,
        metadata: { userMongoId: String(user._id) },
      });
      customerId = customer.id;
      this.logger.log(`Stripe customer creado: ${customerId}`);
      await this.patchUser(user, { stripeCustomerId: customerId });
    } else {
      this.logger.log(`Usando Stripe customer existente: ${customerId}`);
    }

    // Usar la versión de API EXACTA que requiere Stripe (por ejemplo, 2025-11-17.clover)
    const apiVersion = process.env.STRIPE_API_VERSION || '2025-11-17.clover';
    this.logger.log(`Creando ephemeralKey con apiVersion: ${apiVersion}`);
    const ephemeralKey = await this.stripeSvc.stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion },
    );
    this.logger.log(`EphemeralKey creado: ${ephemeralKey.id}`);

    this.logger.log('Creando SetupIntent con automatic_payment_methods y allow_redirects: never...');
    const setupIntent = await this.stripeSvc.stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
    });
    this.logger.log(`SetupIntent creado: ${setupIntent.id}`);
    this.logger.log('Respuesta completa de SetupIntent: ' + JSON.stringify(setupIntent, null, 2));

    const response = {
      setupIntentClientSecret: setupIntent.client_secret,
      customerId,
      customerEphemeralKeySecret: ephemeralKey.secret,
    };
    this.logger.log('=== FIN mobilePaymentSheetSetupIntent ===');
    this.logger.log(`Response: ${JSON.stringify(response, null, 2)}`);
    return response;
  }

  // -----------------------------
  // MOBILE — Obtener métodos de pago guardados del usuario
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('mobile/customer/payment-methods')
  async getCustomerPaymentMethods(@Req() req: any) {
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);
    if (!user.stripeCustomerId) {
      throw new BadRequestException('El usuario no tiene Stripe customerId');
    }
    this.logger.log(`[getCustomerPaymentMethods] Buscando métodos de pago para customerId: ${user.stripeCustomerId}`);
    const paymentMethods = await this.stripeSvc.stripe.paymentMethods.list({
      customer: user.stripeCustomerId,
      type: 'card',
    });
    this.logger.log(`[getCustomerPaymentMethods] Métodos encontrados: ${paymentMethods.data.length}`);
    return { paymentMethods: paymentMethods.data };
  }

  // -----------------------------
  // WEB — Checkout Subscription
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('web/checkout/subscription')
  async webCheckoutSubscription(@Req() req: any, @Body() body: { priceId: string }) {
    this.logger.log('=== INICIO webCheckoutSubscription ===');
    this.logger.log(`priceId: ${body.priceId}`);
    
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);
    this.logger.log(`Usuario: ${user._id}, email: ${user.email}`);

    const session = await this.stripeSvc.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: body.priceId, quantity: 1 }],
      client_reference_id: String(user._id),
      metadata: { userMongoId: String(user._id), flow: 'subscription_web' },
      success_url: `${process.env.FRONTEND_WEB_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_WEB_URL}/billing/cancel`,
      customer_email: user.email,
    });
    
    this.logger.log(`Session creada: ${session.id}, url: ${session.url}`);
    this.logger.log('=== FIN webCheckoutSubscription ===');

    return { url: session.url };
  }

  // -----------------------------
  // WEB — Checkout TipJar
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('web/checkout/tipjar')
  async webCheckoutTipJar(@Req() req: any, @Body() body: { amountMXN: number }) {
    this.logger.log('=== INICIO webCheckoutTipJar ===');
    this.logger.log(`amountMXN: ${body.amountMXN}`);
    
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);
    this.logger.log(`Usuario: ${user._id}, email: ${user.email}`);

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
    
    this.logger.log(`Session creada: ${session.id}, url: ${session.url}`);
    this.logger.log('=== FIN webCheckoutTipJar ===');

    return { url: session.url };
  }

  // -----------------------------
  // MOBILE — PaymentSheet Subscription
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('mobile/paymentsheet/subscription')
  async mobilePaymentSheetSubscription(@Req() req: any, @Body() body: { priceId: string; paymentMethodId: string }) {
    this.logger.log('=== INICIO mobilePaymentSheetSubscription ===');
    this.logger.log(`[mobilePaymentSheetSubscription] priceId recibido: ${body.priceId}`);
    this.logger.log(`[mobilePaymentSheetSubscription] paymentMethodId recibido: ${body.paymentMethodId}`);

    const authId = this.getAuthUserId(req);
    this.logger.log(`[mobilePaymentSheetSubscription] authId: ${authId}`);

    const user = await this.findUserByAuthId(authId);
    this.logger.log(`[mobilePaymentSheetSubscription] Usuario encontrado: ${user._id}, email: ${user.email}, stripeCustomerId: ${user.stripeCustomerId || 'null'}`);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      this.logger.log('[mobilePaymentSheetSubscription] Creando nuevo Stripe customer...');
      const customer = await this.stripeSvc.stripe.customers.create({
        email: user.email,
        metadata: { userMongoId: String(user._id) },
      });
      customerId = customer.id;
      this.logger.log(`[mobilePaymentSheetSubscription] Stripe customer creado: ${customerId}`);
      await this.patchUser(user, { stripeCustomerId: customerId });
      user.stripeCustomerId = customerId; // Actualiza el objeto en memoria para siguientes pasos
    } else {
      this.logger.log(`[mobilePaymentSheetSubscription] Usando Stripe customer existente: ${customerId}`);
    }

    // Adjuntar el paymentMethodId al customer y marcarlo como default
    if (body.paymentMethodId) {
      this.logger.log(`[mobilePaymentSheetSubscription] Adjuntando paymentMethodId ${body.paymentMethodId} al customer ${customerId}...`);
      await this.stripeSvc.stripe.paymentMethods.attach(body.paymentMethodId, {
        customer: customerId,
      });
      await this.stripeSvc.stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: body.paymentMethodId },
      });
      this.logger.log(`[mobilePaymentSheetSubscription] paymentMethodId adjuntado y marcado como default.`);
    } else {
      this.logger.warn('[mobilePaymentSheetSubscription] No se recibió paymentMethodId, la suscripción puede fallar si el customer no tiene método de pago por defecto.');
    }

    this.logger.log('[mobilePaymentSheetSubscription] Creando ephemeralKey...');
    const ephemeralKey = await this.stripeSvc.stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: (process.env.STRIPE_API_VERSION as any) || '2024-06-20' },
    );
    this.logger.log(`[mobilePaymentSheetSubscription] EphemeralKey creado: ${ephemeralKey.id}`);

    this.logger.log(`[mobilePaymentSheetSubscription] Creando subscription con priceId: ${body.priceId}...`);
    const subscription = await this.stripeSvc.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: body.priceId }],
      payment_behavior: 'default_incomplete',
      metadata: { userMongoId: String(user._id), flow: 'subscription_mobile' },
      expand: ['latest_invoice.payment_intent'],
    });

    this.logger.log(`[mobilePaymentSheetSubscription] Subscription creada: ${subscription.id}, status: ${subscription.status}`);
    this.logger.log('[mobilePaymentSheetSubscription] Stripe subscription response completo:');
    this.logger.log(JSON.stringify(subscription, null, 2));

    const latestInvoice = subscription.latest_invoice;
    this.logger.log(`[mobilePaymentSheetSubscription] latest_invoice type: ${typeof latestInvoice}`);
    this.logger.log(`[mobilePaymentSheetSubscription] latest_invoice: ${JSON.stringify(latestInvoice, null, 2)}`);

    let paymentIntent: any = null;
    if (latestInvoice && typeof latestInvoice !== 'string' && 'payment_intent' in latestInvoice) {
      paymentIntent = latestInvoice.payment_intent;
      this.logger.log(`[mobilePaymentSheetSubscription] payment_intent extraído type: ${typeof paymentIntent}`);
      this.logger.log(`[mobilePaymentSheetSubscription] payment_intent: ${JSON.stringify(paymentIntent, null, 2)}`);
    } else {
      this.logger.warn('[mobilePaymentSheetSubscription] No se pudo extraer payment_intent de latest_invoice. Esto puede ocurrir si el método de pago no está adjuntado, el trial es gratis, o el primer pago es $0.');
    }

    if (!paymentIntent) {
      this.logger.warn('[mobilePaymentSheetSubscription] paymentIntent es null o undefined. Verifica que el método de pago esté adjuntado al customer y que la suscripción requiera pago inmediato.');
      throw new BadRequestException('No se pudo obtener el paymentIntent de Stripe. Revisa que el priceId existe, el método de pago está adjuntado y la suscripción requiere pago inmediato.');
    }
    
    // Si paymentIntent es string (ID), necesitamos expandirlo
    if (typeof paymentIntent === 'string') {
      this.logger.log(`paymentIntent es string (ID): ${paymentIntent}, expandiendo...`);
      paymentIntent = await this.stripeSvc.stripe.paymentIntents.retrieve(paymentIntent);
      this.logger.log(`paymentIntent expandido: ${JSON.stringify(paymentIntent, null, 2)}`);
    }
    
    if (!paymentIntent.client_secret) {
      this.logger.error(`paymentIntent no tiene client_secret. Estado: ${paymentIntent.status}`);
      throw new BadRequestException(`PaymentIntent sin client_secret. Estado: ${paymentIntent.status}. Puede que el pago ya fue procesado.`);
    }
    
    this.logger.log(`client_secret obtenido: ${paymentIntent.client_secret.substring(0, 20)}...`);

    // Guardar todos los campos relevantes de Stripe
    this.logger.log('Actualizando usuario en BD con datos de Stripe...');
    await this.patchUser(user, {
      stripeCustomerId: customerId,
      premiumSubscriptionId: subscription.id,
      premiumSubscriptionStatus: subscription.status,
      premiumUntil: null // Se puede actualizar por webhook si aplica
    });
    this.logger.log('Usuario actualizado correctamente en BD');

    const response = {
      customerId,
      ephemeralKeySecret: ephemeralKey.secret,
      paymentIntentClientSecret: paymentIntent.client_secret,
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    };
    
    this.logger.log('=== FIN mobilePaymentSheetSubscription - Respuesta enviada ===');
    this.logger.log(`Response: ${JSON.stringify(response, null, 2)}`);
    
    return response;
  }

  // -----------------------------
  // MOBILE — PaymentSheet TipJar (monto fijo o libre)
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('mobile/paymentsheet/tipjar')
  async mobilePaymentSheetTipJar(@Req() req: any, @Body() body: { amountMXN: number }) {
    this.logger.log('=== INICIO mobilePaymentSheetTipJar ===');
    this.logger.log(`amountMXN: ${body.amountMXN}`);
    
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);
    this.logger.log(`Usuario: ${user._id}, stripeCustomerId: ${user.stripeCustomerId || 'null'}`);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      this.logger.log('Creando nuevo Stripe customer...');
      const customer = await this.stripeSvc.stripe.customers.create({
        email: user.email,
        metadata: { userMongoId: String(user._id) },
      });
      customerId = customer.id;
      this.logger.log(`Stripe customer creado: ${customerId}`);
      await this.patchUser(user, { stripeCustomerId: customerId });
    } else {
      this.logger.log(`Usando Stripe customer existente: ${customerId}`);
    }

    this.logger.log('Creando ephemeralKey...');
    const ephemeralKey = await this.stripeSvc.stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: (process.env.STRIPE_API_VERSION as any) || '2024-06-20' },
    );
    this.logger.log(`EphemeralKey creado: ${ephemeralKey.id}`);

    this.logger.log('Creando PaymentIntent...');
    const paymentIntent = await this.stripeSvc.stripe.paymentIntents.create({
      amount: Math.round(body.amountMXN * 100),
      currency: 'mxn',
      customer: customerId,
      metadata: { userMongoId: String(user._id), flow: 'tipjar_mobile' },
      automatic_payment_methods: { enabled: true },
    });
    this.logger.log(`PaymentIntent creado: ${paymentIntent.id}, client_secret: ${paymentIntent.client_secret?.substring(0, 20)}...`);

    const response = {
      customerId,
      ephemeralKeySecret: ephemeralKey.secret,
      paymentIntentClientSecret: paymentIntent.client_secret,
    };
    
    this.logger.log('=== FIN mobilePaymentSheetTipJar ===');
    this.logger.log(`Response: ${JSON.stringify(response, null, 2)}`);

    return response;
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
