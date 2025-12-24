import { Test, TestingModule } from '@nestjs/testing';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';
import { getModelToken } from '@nestjs/mongoose';
import { User } from '../user/schemas/user.schema/user.schema';

// Mock User Model
const mockUserModel = {
  findById: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
};

// Mock StripeService
const mockStripeService = {
  stripe: {
    checkout: {
      sessions: {
        create: jest.fn(),
      },
    },
    customers: {
      create: jest.fn(),
    },
    ephemeralKeys: {
      create: jest.fn(),
    },
    subscriptions: {
      create: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
      list: jest.fn(),
    },
    billingPortal: {
      sessions: {
        create: jest.fn(),
      },
    },
    paymentIntents: {
      create: jest.fn(),
    },
    invoices: {
      retrieve: jest.fn(),
    },
    refunds: {
      create: jest.fn(),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  },
  giftDaysForJar: jest.fn(),
  extendPremiumUntil: jest.fn(),
};

describe('StripeController', () => {
  let controller: StripeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeController],
      providers: [
        { provide: StripeService, useValue: mockStripeService },
        { provide: getModelToken(User.name), useValue: mockUserModel },
      ],
    }).compile();

    controller = module.get<StripeController>(StripeController);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('debería crear una sesión de suscripción web', async () => {
    const req = { user: { id: 'user123' } };
    const user = { _id: 'mongoId', email: 'test@mail.com' };
    mockUserModel.findById.mockResolvedValueOnce(null);
    mockUserModel.findOne.mockResolvedValueOnce(user);
    mockStripeService.stripe.checkout.sessions.create.mockResolvedValueOnce({ url: 'https://stripe.com/checkout' });

    const result = await controller.webCheckoutSubscription(req, { priceId: 'price_123' });
    expect(result).toHaveProperty('url', 'https://stripe.com/checkout');
  });

  it('debería crear una sesión de tipjar web', async () => {
    const req = { user: { id: 'user123' } };
    const user = { _id: 'mongoId', email: 'test@mail.com' };
    mockUserModel.findById.mockResolvedValueOnce(null);
    mockUserModel.findOne.mockResolvedValueOnce(user);
    mockStripeService.stripe.checkout.sessions.create.mockResolvedValueOnce({ url: 'https://stripe.com/tipjar' });

    const result = await controller.webCheckoutTipJar(req, { amountMXN: 100 });
    expect(result).toHaveProperty('url', 'https://stripe.com/tipjar');
  });

  it('debería manejar el webhook correctamente', async () => {
    const req: any = { rawBody: Buffer.from('{}'), headers: {} };
    const sig = 'testsig';
    const event = { type: 'checkout.session.completed', data: { object: { mode: 'payment', metadata: { userMongoId: 'mongoId' }, amount_total: 2000 } } };
    const user = { _id: 'mongoId', premiumUntil: null };
    mockStripeService.stripe.webhooks.constructEvent.mockReturnValueOnce(event);
    mockUserModel.findById.mockResolvedValueOnce(user);
    mockStripeService.giftDaysForJar.mockReturnValueOnce(7);
    mockStripeService.extendPremiumUntil.mockReturnValueOnce(new Date('2025-12-31'));

    const result = await controller.webhook(req, sig);
    expect(result).toEqual({ received: true });

    expect(mockStripeService.giftDaysForJar).toHaveBeenCalled();
    expect(mockUserModel.findById).toHaveBeenCalledWith('mongoId');

    expect(mockStripeService.extendPremiumUntil).toHaveBeenCalled();
  });

  it('debería marcar cancelación al fin de periodo (cancel-renewal)', async () => {
    const req = { user: { id: 'user123' } };
    const user: any = { _id: 'mongoId', email: 'test@mail.com', stripeCustomerId: 'cus_123', premiumSubscriptionId: 'sub_123' };
    mockUserModel.findById.mockResolvedValueOnce(null);
    mockUserModel.findOne.mockResolvedValueOnce(user);
    mockStripeService.stripe.subscriptions.update.mockResolvedValueOnce({
      id: 'sub_123',
      status: 'active',
      cancel_at_period_end: true,
      current_period_end: 1735689600,
    });
    mockUserModel.updateOne.mockResolvedValueOnce({});

    const result = await controller.cancelSubscriptionRenewal(req as any, { subscriptionId: 'sub_123' });
    expect(result).toEqual({
      subscriptionId: 'sub_123',
      status: 'active',
      cancel_at_period_end: true,
      current_period_end: 1735689600,
    });
    expect(mockStripeService.stripe.subscriptions.update).toHaveBeenCalledWith('sub_123', { cancel_at_period_end: true });
  });

  it('debería crear un reembolso (admin/refund) usando paymentIntentId', async () => {
    mockStripeService.stripe.refunds.create.mockResolvedValueOnce({
      id: 're_123',
      status: 'succeeded',
      amount: 3900,
      currency: 'mxn',
      reason: 'requested_by_customer',
    });

    const result = await controller.adminRefund({ paymentIntentId: 'pi_123', amountMXN: 39, reason: 'requested_by_customer' });
    expect(result).toEqual({
      refundId: 're_123',
      status: 'succeeded',
      amount: 3900,
      currency: 'mxn',
      reason: 'requested_by_customer',
    });
    expect(mockStripeService.stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_123', amount: 3900, reason: 'requested_by_customer' }),
    );
  });
});
