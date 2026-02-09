import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BadRequestException } from '@nestjs/common';

describe('AuthController (activateDirect)', () => {
  let controller: AuthController;
  let authService: Partial<AuthService>;

  beforeEach(() => {
    authService = {
      confirmAccount: jest.fn().mockResolvedValue({ success: true, message: 'Cuenta activada correctamente' }),
    };

    controller = new AuthController(authService as AuthService);
  });

  it('calls confirmAccount with token and returns success', async () => {
    const token = 'sample-token-123';
    const res = await controller.activateDirect(null, null, null, null, token);
    expect((authService.confirmAccount as jest.Mock).mock.calls.length).toBe(1);
    expect((authService.confirmAccount as jest.Mock).mock.calls[0][0]).toBe(token);
    expect(res).toEqual({ success: true, message: 'Cuenta activada correctamente' });
  });

  it('throws BadRequestException when token is missing', async () => {
    await expect(controller.activateDirect(null, null, null, null, undefined as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
