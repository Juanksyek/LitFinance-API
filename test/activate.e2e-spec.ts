import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ActivationController } from '../src/auth/activation.controller';
import { AuthService } from '../src/auth/auth.service';

describe('Activation endpoint (e2e-lite)', () => {
  let app: INestApplication;
  const authService = {
    confirmAccount: jest.fn().mockResolvedValue({ success: true, message: 'Cuenta activada correctamente' }),
  };

  beforeAll(async () => {
    process.env.FRONTEND_URL = 'https://thelitfinance.com';

    const moduleRef = await Test.createTestingModule({
      controllers: [ActivationController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /activate/:token redirects to frontend and calls confirmAccount', async () => {
    await request(app.getHttpServer())
      .get('/activate/abc123')
      .expect(302)
      .expect('Location', 'https://thelitfinance.com/activate/abc123');

    expect(authService.confirmAccount).toHaveBeenCalledWith('abc123');
  });
});
