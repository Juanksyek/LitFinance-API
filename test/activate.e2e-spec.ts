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

  it('GET /activate/:token returns success and calls confirmAccount', async () => {
    await request(app.getHttpServer())
      .get('/activate/abc123')
      .expect(200)
      .expect({ success: true, message: 'Cuenta activada correctamente' });

    expect(authService.confirmAccount).toHaveBeenCalledWith('abc123');
  });
});
