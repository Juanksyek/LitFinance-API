import { Body, Controller, Get, Headers, Post, Req, BadRequestException, UseGuards, Logger } from '@nestjs/common';
import { StripeService } from './stripe.service';
import type { Request } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

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

    // Asegurar customerId y bloquear doble suscripción
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripeSvc.stripe.customers.create({
        email: user.email,
        metadata: { userMongoId: String(user._id) },
      });
      customerId = customer.id;
      await this.patchUser(user, { stripeCustomerId: customerId });
      user.stripeCustomerId = customerId;
    }

    const subs = await this.stripeSvc.stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 10,
    });

    const blockingStatuses = ['active', 'trialing', 'past_due', 'unpaid'];
    const hasBlocking = subs.data.some((s: any) => blockingStatuses.includes(s.status));
    if (hasBlocking) {
      throw new BadRequestException('Ya tienes una suscripción activa o en proceso');
    }

    const incompleteSubs = subs.data.filter((s: any) => ['incomplete', 'incomplete_expired'].includes(s.status));
    for (const s of incompleteSubs) {
      try {
        await this.stripeSvc.stripe.subscriptions.cancel(s.id);
      } catch {
        // ignore
      }
    }

    const session = await this.stripeSvc.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: body.priceId, quantity: 1 }],
      client_reference_id: String(user._id),
      metadata: { userMongoId: String(user._id), flow: 'subscription_web' },
      success_url: `${process.env.FRONTEND_WEB_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_WEB_URL}/billing/cancel`,
      customer: customerId,
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

    // Verificar si el usuario ya tiene una suscripción activa para este priceId
    this.logger.log(`[mobilePaymentSheetSubscription] Verificando suscripciones existentes para customerId: ${customerId}...`);
    const existingSubscriptions = await this.stripeSvc.stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 10,
    });
    
    const hasActiveSubscription = existingSubscriptions.data.some(sub => 
      sub.items.data.some(item => item.price.id === body.priceId)
    );
    
    if (hasActiveSubscription) {
      this.logger.warn(`[mobilePaymentSheetSubscription] El usuario ya tiene una suscripción activa para el priceId: ${body.priceId}`);
      throw new BadRequestException('Ya tienes una suscripción activa a este plan. No puedes crear otra.');
    }
    
    this.logger.log('[mobilePaymentSheetSubscription] No hay suscripciones activas para este plan, continuando...');
    
    // Verificar si hay suscripciones incompletas y cancelarlas
    const incompleteSubscriptions = await this.stripeSvc.stripe.subscriptions.list({
      customer: customerId,
      status: 'incomplete',
      limit: 10,
    });
    
    if (incompleteSubscriptions.data.length > 0) {
      this.logger.warn(`[mobilePaymentSheetSubscription] Encontradas ${incompleteSubscriptions.data.length} suscripciones incompletas. Cancelando...`);
      for (const sub of incompleteSubscriptions.data) {
        await this.stripeSvc.stripe.subscriptions.cancel(sub.id);
        this.logger.log(`[mobilePaymentSheetSubscription] Suscripción incompleta cancelada: ${sub.id}`);
      }
    }

    // Adjuntar el paymentMethodId al customer y marcarlo como default
    if (body.paymentMethodId) {
      this.logger.log(`[mobilePaymentSheetSubscription] Adjuntando paymentMethodId ${body.paymentMethodId} al customer ${customerId}...`);
      try {
        const attached = await this.stripeSvc.stripe.paymentMethods.attach(body.paymentMethodId, {
          customer: customerId,
        });
        this.logger.log(`[mobilePaymentSheetSubscription] Resultado de attach: ${JSON.stringify(attached, null, 2)}`);
        
        await this.stripeSvc.stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: body.paymentMethodId },
        });
        this.logger.log(`[mobilePaymentSheetSubscription] paymentMethodId adjuntado y marcado como default.`);
      } catch (err: any) {
        this.logger.error(`[mobilePaymentSheetSubscription] Error al adjuntar paymentMethodId: ${err.message}`);
        if (err.code === 'resource_already_attached') {
          this.logger.log('[mobilePaymentSheetSubscription] El paymentMethod ya estaba adjuntado, continuando...');
          await this.stripeSvc.stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: body.paymentMethodId },
          });
        } else {
          throw err;
        }
      }
    } else {
      this.logger.warn('[mobilePaymentSheetSubscription] No se recibió paymentMethodId, la suscripción puede fallar si el customer no tiene método de pago por defecto.');
    }

    this.logger.log('[mobilePaymentSheetSubscription] Creando ephemeralKey...');
    const apiVersion = process.env.STRIPE_API_VERSION || '2025-11-17.clover';
    const ephemeralKey = await this.stripeSvc.stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion },
    );
    this.logger.log(`[mobilePaymentSheetSubscription] EphemeralKey creado: ${ephemeralKey.id}`);

    this.logger.log(`[mobilePaymentSheetSubscription] Creando subscription con priceId: ${body.priceId}...`);
    const subscriptionParams: any = {
      customer: customerId,
      items: [{ price: body.priceId }],
      payment_behavior: 'default_incomplete',
      collection_method: 'charge_automatically',
      // Clave: fuerza métodos para invoices/subscription
      payment_settings: {
        payment_method_types: ['card'],
        // Recomendado por Stripe para que se guarde como default tras el primer pago
        save_default_payment_method: 'on_subscription',
      },
      metadata: { userMongoId: String(user._id), flow: 'subscription_mobile' },
      // Expande ambos niveles
      expand: ['latest_invoice', 'latest_invoice.payment_intent'],
    };
    
    // Si tenemos paymentMethodId, especificarlo directamente en la suscripción
    if (body.paymentMethodId) {
      subscriptionParams.default_payment_method = body.paymentMethodId;
      this.logger.log(`[mobilePaymentSheetSubscription] Usando default_payment_method en la suscripción: ${body.paymentMethodId}`);
    }
    
    const subscription = await this.stripeSvc.stripe.subscriptions.create(subscriptionParams);

    this.logger.log(`[mobilePaymentSheetSubscription] Subscription creada: ${subscription.id}, status: ${subscription.status}`);
    this.logger.log('[mobilePaymentSheetSubscription] Stripe subscription response completo:');
    this.logger.log(JSON.stringify(subscription, null, 2));

    // Obtener invoiceId sí o sí
    const invoiceId =
      typeof subscription.latest_invoice === 'string'
        ? subscription.latest_invoice
        : subscription.latest_invoice?.id;

    if (!invoiceId) {
      this.logger.error('[mobilePaymentSheetSubscription] Stripe no devolvió latest_invoice en la suscripción.');
      throw new BadRequestException('Stripe no devolvió latest_invoice en la suscripción.');
    }

    this.logger.log(`[mobilePaymentSheetSubscription] Recuperando invoice ${invoiceId} con expand...`);
    // Recuperar el invoice con expand de payments (recomendado por Stripe API reciente)
    let invoice: any = await this.stripeSvc.stripe.invoices.retrieve(invoiceId, {
      expand: ['payments.data.payment', 'payments.data.payment.payment_intent'],
    });

    // Log útil para diagnóstico
    this.logger.log(
      `[mobilePaymentSheetSubscription] Invoice ${invoiceId}: status=${invoice.status}, amount_due=${invoice.amount_due}, ` +
      `attempted=${invoice.attempted}, auto_advance=${invoice.auto_advance}, collection_method=${invoice.collection_method}`
    );

    // ✅ OPCIÓN 1 (recomendada): usar confirmation_secret.client_secret
    const confirmationSecret = invoice?.confirmation_secret?.client_secret;
    if (confirmationSecret) {
      this.logger.log(`[mobilePaymentSheetSubscription] ✅ Usando invoice.confirmation_secret.client_secret`);
      
      // Guardar todos los campos relevantes de Stripe
      await this.patchUser(user, {
        stripeCustomerId: customerId,
        premiumSubscriptionId: subscription.id,
        premiumSubscriptionStatus: subscription.status,
        premiumUntil: user.premiumUntil || null // No borrar premiumUntil (donaciones). Webhook/sync lo ajusta.
      });

      return {
        customerId,
        ephemeralKeySecret: ephemeralKey.secret,
        paymentIntentClientSecret: confirmationSecret,
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
      };
    }

    // ✅ OPCIÓN 2 (fallback): sacar payment_intent de payments
    // payments puede venir como LISTA (payments.data) o como OBJETO (payments)
    let piCandidate: any = null;

    // Caso A: payments como lista
    if (Array.isArray(invoice?.payments?.data)) {
      const defaultPayment = invoice.payments.data.find((p: any) => p?.is_default) ?? invoice.payments.data[0];
      piCandidate = defaultPayment?.payment?.payment_intent;
      this.logger.log(`[mobilePaymentSheetSubscription] Buscando PI en payments.data (lista), encontrado: ${!!piCandidate}`);
    }

    // Caso B: payments como objeto directo (estructura actual de Stripe)
    if (!piCandidate && invoice?.payments?.payment?.payment_intent) {
      piCandidate = invoice.payments.payment.payment_intent;
      this.logger.log(`[mobilePaymentSheetSubscription] Encontrado PI en payments.payment.payment_intent (objeto directo)`);
    }

    // 3) piCandidate puede ser string (id) o objeto expandido
    let paymentIntent: any = null;

    if (typeof piCandidate === 'string') {
      this.logger.log(`[mobilePaymentSheetSubscription] PI es string, recuperando: ${piCandidate}`);
      paymentIntent = await this.stripeSvc.stripe.paymentIntents.retrieve(piCandidate);
    } else if (piCandidate && typeof piCandidate === 'object') {
      this.logger.log(`[mobilePaymentSheetSubscription] PI ya expandido: ${piCandidate.id}`);
      paymentIntent = piCandidate;
    }

    if (paymentIntent?.client_secret) {
      this.logger.log(`[mobilePaymentSheetSubscription] ✅ Client secret obtenido: ${paymentIntent.client_secret.substring(0, 20)}...`);
      
      // Guardar todos los campos relevantes de Stripe
      await this.patchUser(user, {
        stripeCustomerId: customerId,
        premiumSubscriptionId: subscription.id,
        premiumSubscriptionStatus: subscription.status,
        premiumUntil: user.premiumUntil || null // No borrar premiumUntil (donaciones). Webhook/sync lo ajusta.
      });

      return {
        customerId,
        ephemeralKeySecret: ephemeralKey.secret,
        paymentIntentClientSecret: paymentIntent.client_secret,
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
      };
    }

    // ❌ Último fallback: si no hay nada, registra todo lo necesario para diagnóstico
    this.logger.error(
      `[mobilePaymentSheetSubscription] Invoice ${invoiceId} sin client_secret. ` +
      `status=${invoice.status}, attempted=${invoice.attempted}, auto_advance=${invoice.auto_advance}, ` +
      `confirmation_secret=${JSON.stringify(invoice.confirmation_secret)}, ` +
      `payments=${JSON.stringify(invoice.payments)}, payment_settings=${JSON.stringify(invoice.payment_settings)}`
    );

    throw new BadRequestException(
      `Invoice ${invoiceId} no expuso client_secret. Revisa Payment Methods + Billing config.`
    );
  }

  private async patchUser(user: any, updates: any) {
    await this.userModel.updateOne({ _id: user._id }, { $set: updates });
  }

  private addDays(base: Date, days: number) {
    const next = new Date(base);
    next.setDate(next.getDate() + days);
    return next;
  }

  private async resolveCurrentSubscriptionForUser(user: any): Promise<any | null> {
    // Primero: si ya tenemos subscriptionId real, intenta recuperar esa
    if (
      user?.premiumSubscriptionId &&
      typeof user.premiumSubscriptionId === 'string' &&
      user.premiumSubscriptionId.length > 0 &&
      user.premiumSubscriptionId !== 'tipjar'
    ) {
      try {
        return await this.stripeSvc.stripe.subscriptions.retrieve(user.premiumSubscriptionId);
      } catch {
        // ignore
      }
    }

    // Fallback: lista las suscripciones del customer
    if (!user?.stripeCustomerId) return null;
    const subs = await this.stripeSvc.stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: 'all',
      limit: 10,
    });

    const priority = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];
    for (const st of priority) {
      const found = subs.data.find((s: any) => s.status === st);
      if (found) return found;
    }
    return subs.data[0] || null;
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscription/sync')
  async syncSubscription(@Req() req: any) {
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);

    const sub: any = await this.resolveCurrentSubscriptionForUser(user);
    const bonusDays = Number((user as any).premiumBonusDays || 0);

    if (!sub) {
      const currentPremiumUntil = user.premiumUntil ? new Date(user.premiumUntil) : null;
      const derivedStatus = currentPremiumUntil && currentPremiumUntil.getTime() > Date.now() ? 'active' : 'expired';
      await this.patchUser(user, {
        premiumSubscriptionStatus: user.premiumSubscriptionStatus || derivedStatus,
        premiumUntil: currentPremiumUntil,
      });
      return {
        stripeCustomerId: user.stripeCustomerId || null,
        premiumSubscriptionId: user.premiumSubscriptionId || null,
        premiumSubscriptionStatus: user.premiumSubscriptionStatus || derivedStatus,
        premiumUntil: currentPremiumUntil,
        premiumBonusDays: bonusDays,
      };
    }

    const currentPeriodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
    const effectiveUntil = currentPeriodEnd ? this.addDays(currentPeriodEnd, bonusDays) : (user.premiumUntil || null);

    await this.patchUser(user, {
      premiumSubscriptionId: sub.id,
      premiumSubscriptionStatus: sub.status,
      premiumUntil: effectiveUntil,
    });

    return {
      stripeCustomerId: user.stripeCustomerId || null,
      premiumSubscriptionId: sub.id,
      premiumSubscriptionStatus: sub.status,
      premiumUntil: effectiveUntil,
      premiumBonusDays: bonusDays,
    };
  }

  private async resolveSubscriptionIdForUser(user: any, subscriptionId?: string) {
    if (subscriptionId) return subscriptionId;
    if (user?.premiumSubscriptionId) return String(user.premiumSubscriptionId);
    if (!user?.stripeCustomerId) {
      throw new BadRequestException('El usuario no tiene Stripe customerId');
    }

    const subs = await this.stripeSvc.stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: 'all',
      limit: 10,
    });

    const candidate = subs.data.find((s: any) =>
      ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(s.status),
    );
    if (!candidate) {
      throw new BadRequestException('No se encontró una suscripción asociada a este usuario');
    }
    return candidate.id;
  }

  private normalizeRefundReason(reason?: string) {
    const r = String(reason || '').trim();
    if (r === 'duplicate' || r === 'fraudulent' || r === 'requested_by_customer') return r;
    return 'requested_by_customer';
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
  @Get('webhook')
  webhookHealth() {
    return { ok: true };
  }

  @Post('webhook')
  async webhook(@Req() req: Request, @Headers('stripe-signature') sig: string) {
    let event: any;

    this.logger.log('--- Stripe Webhook recibido ---');
    this.logger.log('Headers:', JSON.stringify(req.headers));
    // Depuración: loguear tipo y contenido del body
    this.logger.log(`[DEBUG] typeof req.body: ${typeof (req as any).body}`);
    this.logger.log(`[DEBUG] Buffer.isBuffer(req.body): ${Buffer.isBuffer((req as any).body)}`);
    if (Buffer.isBuffer((req as any).body)) {
      this.logger.log(`[DEBUG] req.body.length: ${(req as any).body.length}`);
      this.logger.log(`[DEBUG] req.body.slice(0,32): ${(req as any).body.slice(0,32).toString('hex')}`);
    }
    this.logger.log(`[DEBUG] typeof req.rawBody: ${typeof (req as any).rawBody}`);
    this.logger.log(`[DEBUG] Buffer.isBuffer(req.rawBody): ${Buffer.isBuffer((req as any).rawBody)}`);
    if (Buffer.isBuffer((req as any).rawBody)) {
      this.logger.log(`[DEBUG] req.rawBody.length: ${(req as any).rawBody.length}`);
      this.logger.log(`[DEBUG] req.rawBody.slice(0,32): ${(req as any).rawBody.slice(0,32).toString('hex')}`);
    }
    try {
      const payload: any = (req as any).rawBody ?? (req as any).body;
      if (!payload) {
        throw new Error('Missing raw payload (rawBody/body)');
      }
      event = this.stripeSvc.stripe.webhooks.constructEvent(
        payload,
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
        if (!userMongoId) break;

        // TipJar web (payment)
        if (session.mode === 'payment') {
          const amount = (session.amount_total || 0) / 100;
          const days = this.stripeSvc.giftDaysForJar(amount);
          this.logger.log(`[checkout.session.completed] (tipjar_web) Monto: $${amount} MXN, Días a regalar: ${days}`);

          if (days > 0) {
            const user = await this.userModel.findById(userMongoId);
            if (!user) {
              this.logger.warn(`[checkout.session.completed] Usuario no encontrado: ${userMongoId}`);
              break;
            }

            const nextBonusDays = Number((user as any).premiumBonusDays || 0) + days;
            const currentPremiumUntil = user.premiumUntil ? new Date(user.premiumUntil) : null;

            const sub: any = await this.resolveCurrentSubscriptionForUser(user);
            if (sub?.current_period_end) {
              const periodEnd = new Date(sub.current_period_end * 1000);
              const effectiveUntil = this.addDays(periodEnd, nextBonusDays);
              await this.patchUser(user, {
                premiumBonusDays: nextBonusDays,
                premiumSubscriptionId: sub.id,
                premiumSubscriptionStatus: sub.status,
                premiumUntil: effectiveUntil,
              });
            } else {
              const effectiveUntil = this.stripeSvc.extendPremiumUntil(currentPremiumUntil, days);
              const status = effectiveUntil.getTime() > Date.now() ? 'active' : 'expired';
              await this.patchUser(user, {
                premiumBonusDays: nextBonusDays,
                premiumSubscriptionId: (user as any).premiumSubscriptionId || 'tipjar',
                premiumSubscriptionStatus: (user as any).premiumSubscriptionStatus || status,
                premiumUntil: effectiveUntil,
              });
            }
          }
          break;
        }

        // Checkout web de suscripción
        if (session.mode === 'subscription') {
          const subscriptionId = session.subscription;
          if (!subscriptionId) break;

          const user = await this.userModel.findById(userMongoId);
          if (!user) {
            this.logger.warn(`[checkout.session.completed] Usuario no encontrado: ${userMongoId}`);
            break;
          }

          const sub: any = await this.stripeSvc.stripe.subscriptions.retrieve(subscriptionId);
          const bonusDays = Number((user as any).premiumBonusDays || 0);
          const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
          const effectiveUntil = periodEnd ? this.addDays(periodEnd, bonusDays) : (user.premiumUntil || null);

          await this.patchUser(user, {
            premiumSubscriptionId: sub.id,
            premiumSubscriptionStatus: sub.status,
            premiumUntil: effectiveUntil,
          });
          break;
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
              const nextBonusDays = Number((user as any).premiumBonusDays || 0) + days;
              const currentPremiumUntil = user.premiumUntil ? new Date(user.premiumUntil) : null;

              const sub: any = await this.resolveCurrentSubscriptionForUser(user);
              if (sub?.current_period_end) {
                const periodEnd = new Date(sub.current_period_end * 1000);
                const effectiveUntil = this.addDays(periodEnd, nextBonusDays);
                await this.patchUser(user, {
                  premiumBonusDays: nextBonusDays,
                  premiumSubscriptionId: sub.id,
                  premiumSubscriptionStatus: sub.status,
                  premiumUntil: effectiveUntil,
                });
              } else {
                const effectiveUntil = this.stripeSvc.extendPremiumUntil(currentPremiumUntil, days);
                const status = effectiveUntil.getTime() > Date.now() ? 'active' : 'expired';
                await this.patchUser(user, {
                  premiumBonusDays: nextBonusDays,
                  premiumSubscriptionId: (user as any).premiumSubscriptionId || 'tipjar',
                  premiumSubscriptionStatus: (user as any).premiumSubscriptionStatus || status,
                  premiumUntil: effectiveUntil,
                });
              }
            } else {
              this.logger.warn(`[payment_intent.succeeded] Usuario no encontrado: ${userMongoId}`);
            }
          }
        }
        break;
      }

      // Suscripción: invoice.payment_succeeded (más común en varios flujos)
      case 'invoice.payment_succeeded': {
        const invoice: any = event.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;
        this.logger.log(`[invoice.payment_succeeded] customerId: ${customerId}, subscriptionId: ${subscriptionId}`);

        if (!subscriptionId) break;

        const subscriptionResponse = await this.stripeSvc.stripe.subscriptions.retrieve(subscriptionId);
        const subscription = (subscriptionResponse as any).current_period_end !== undefined
          ? subscriptionResponse
          : (subscriptionResponse as any).data || subscriptionResponse;

        const user = await this.findByStripeCustomerId(customerId);
        if (!user) {
          this.logger.warn(`[invoice.payment_succeeded] Usuario no encontrado para customerId: ${customerId}`);
          break;
        }

        const bonusDays = Number((user as any).premiumBonusDays || 0);
        const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null;
        const effectiveUntil = periodEnd ? this.addDays(periodEnd, bonusDays) : (user.premiumUntil || null);

        await this.patchUser(user, {
          premiumSubscriptionId: subscriptionId,
          premiumSubscriptionStatus: subscription.status || 'active',
          premiumUntil: effectiveUntil,
        });
        break;
      }

      // Suscripción confirmada (pago de invoice)
      case 'invoice.paid': {
        const invoice: any = event.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;
        this.logger.log(`[invoice.paid] customerId: ${customerId}, subscriptionId: ${subscriptionId}`);
        
        if (subscriptionId) {
          // Obtener detalles de la suscripción para determinar el período
          const subscriptionResponse = await this.stripeSvc.stripe.subscriptions.retrieve(subscriptionId);
          const subscription = (subscriptionResponse as any).current_period_end !== undefined
            ? subscriptionResponse
            : (subscriptionResponse as any).data || subscriptionResponse;
          const user = await this.findByStripeCustomerId(customerId);
          
          if (user) {
            // Calcular premiumUntil basado en el período de la suscripción
            const bonusDays = Number((user as any).premiumBonusDays || 0);
            const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
            const effectiveUntil = this.addDays(currentPeriodEnd, bonusDays);
            
            this.logger.log(
              `[invoice.paid] Actualizando usuario: subscriptionId=${subscriptionId}, status=${subscription.status || 'active'}, ` +
              `periodEnd=${currentPeriodEnd.toISOString()}, bonusDays=${bonusDays}, premiumUntil=${effectiveUntil.toISOString()}`,
            );
            // Siempre sobrescribe los campos premium con la suscripción
            await this.patchUser(user, {
              premiumSubscriptionId: subscriptionId,
              premiumSubscriptionStatus: subscription.status || 'active',
              premiumUntil: effectiveUntil,
            });
          } else {
            this.logger.warn(`[invoice.paid] Usuario no encontrado para customerId: ${customerId}`);
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub: any = event.data.object;
        const customerId = sub.customer;
        const currentPeriodEnd = new Date(sub.current_period_end * 1000);
        
        this.logger.log(`[customer.subscription.updated] customerId: ${customerId}, subId: ${sub.id}, status: ${sub.status}, current_period_end: ${currentPeriodEnd.toISOString()}`);
        const user = await this.findByStripeCustomerId(customerId);
        if (user) {
          const bonusDays = Number((user as any).premiumBonusDays || 0);
          const effectiveUntil = this.addDays(currentPeriodEnd, bonusDays);
          this.logger.log(`[customer.subscription.updated] Actualizando usuario`);
          // Siempre sobrescribe los campos premium con la suscripción
          await this.patchUser(user, {
            premiumSubscriptionId: sub.id,
            premiumSubscriptionStatus: sub.status,
            premiumUntil: effectiveUntil,
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

  // -----------------------------
  // SUBSCRIPTION — Cancelar renovación (no cancela inmediato)
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('subscription/cancel-renewal')
  async cancelSubscriptionRenewal(@Req() req: any, @Body() body: { subscriptionId?: string }) {
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);

    const subId = await this.resolveSubscriptionIdForUser(user, body?.subscriptionId);
    this.logger.log(`[cancelSubscriptionRenewal] user=${user._id} subId=${subId}`);

    const sub: any = await this.stripeSvc.stripe.subscriptions.update(subId, {
      cancel_at_period_end: true,
    });

    const premiumUntil = sub?.current_period_end ? new Date(sub.current_period_end * 1000) : undefined;
    await this.patchUser(user, {
      premiumSubscriptionId: sub.id,
      premiumSubscriptionStatus: sub.status,
      ...(premiumUntil ? { premiumUntil } : {}),
    });

    return {
      subscriptionId: sub.id,
      status: sub.status,
      cancel_at_period_end: sub.cancel_at_period_end,
      current_period_end: sub.current_period_end,
    };
  }

  // -----------------------------
  // SUBSCRIPTION — Reactivar renovación
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('subscription/resume-renewal')
  async resumeSubscriptionRenewal(@Req() req: any, @Body() body: { subscriptionId?: string }) {
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);

    const subId = await this.resolveSubscriptionIdForUser(user, body?.subscriptionId);
    this.logger.log(`[resumeSubscriptionRenewal] user=${user._id} subId=${subId}`);

    const sub: any = await this.stripeSvc.stripe.subscriptions.update(subId, {
      cancel_at_period_end: false,
    });

    const premiumUntil = sub?.current_period_end ? new Date(sub.current_period_end * 1000) : undefined;
    await this.patchUser(user, {
      premiumSubscriptionId: sub.id,
      premiumSubscriptionStatus: sub.status,
      ...(premiumUntil ? { premiumUntil } : {}),
    });

    return {
      subscriptionId: sub.id,
      status: sub.status,
      cancel_at_period_end: sub.cancel_at_period_end,
      current_period_end: sub.current_period_end,
    };
  }

  // -----------------------------
  // BILLING PORTAL — Dejar que Stripe maneje cancelación/métodos de pago
  // -----------------------------
  @UseGuards(JwtAuthGuard)
  @Post('billing-portal/session')
  async createBillingPortalSession(@Req() req: any, @Body() body: { returnUrl?: string }) {
    const authId = this.getAuthUserId(req);
    const user = await this.findUserByAuthId(authId);
    if (!user?.stripeCustomerId) throw new BadRequestException('El usuario no tiene Stripe customerId');

    const returnUrl = body?.returnUrl || `${process.env.FRONTEND_WEB_URL}/billing`;
    const session = await this.stripeSvc.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  // -----------------------------
  // ADMIN — Reembolso (refund)
  // -----------------------------
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('admin/refund')
  async adminRefund(
    @Body()
    body: {
      paymentIntentId?: string;
      chargeId?: string;
      invoiceId?: string;
      amountMXN?: number;
      reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer' | string;
    },
  ) {
    const reason = this.normalizeRefundReason(body?.reason);

    let paymentIntentId = body?.paymentIntentId;
    if (!paymentIntentId && body?.invoiceId) {
      const invoice: any = await this.stripeSvc.stripe.invoices.retrieve(body.invoiceId, {
        expand: ['payment_intent'],
      });
      const pi = invoice?.payment_intent;
      paymentIntentId = typeof pi === 'string' ? pi : pi?.id;
      if (!paymentIntentId) {
        throw new BadRequestException('No se pudo resolver payment_intent desde el invoiceId');
      }
    }

    const params: any = {
      reason,
    };

    if (typeof body?.amountMXN === 'number') {
      if (body.amountMXN <= 0) throw new BadRequestException('amountMXN debe ser > 0');
      params.amount = Math.round(body.amountMXN * 100);
    }

    if (paymentIntentId) {
      params.payment_intent = paymentIntentId;
    } else if (body?.chargeId) {
      params.charge = body.chargeId;
    } else {
      throw new BadRequestException('Debes enviar paymentIntentId o invoiceId o chargeId');
    }

    const refund: any = await this.stripeSvc.stripe.refunds.create(params);
    return {
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason,
    };
  }

  // -----------------------------
  // ADMIN — Cancelar suscripción inmediatamente
  // -----------------------------
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('admin/subscription/cancel-now')
  async adminCancelSubscriptionNow(@Body() body: { subscriptionId: string; userMongoId?: string }) {
    if (!body?.subscriptionId) throw new BadRequestException('subscriptionId es requerido');

    const sub: any = await this.stripeSvc.stripe.subscriptions.cancel(body.subscriptionId);

    if (body?.userMongoId) {
      const user = await this.userModel.findById(body.userMongoId);
      if (user) {
        await this.patchUser(user, {
          premiumSubscriptionId: sub.id,
          premiumSubscriptionStatus: sub.status,
        });
      }
    }

    return {
      subscriptionId: sub.id,
      status: sub.status,
      canceled_at: sub.canceled_at,
    };
  }
}
