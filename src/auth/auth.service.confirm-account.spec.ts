import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService.confirmAccount', () => {
  const makeService = (userModelOverrides: Partial<any> = {}) => {
    const userModel = {
      findOneAndUpdate: jest.fn(),
      findOne: jest.fn(),
      ...userModelOverrides,
    };

    const dummyModel = {} as any;
    const dummyJwt = {} as any;
    const dummyEmail = {} as any;
    const dummyPlanAutoPause = {} as any;

    const service = new AuthService(
      userModel as any,
      dummyModel,
      dummyModel,
      dummyModel,
      dummyJwt,
      dummyEmail,
      dummyPlanAutoPause,
    );

    return { service, userModel };
  };

  it('activates account when token is valid', async () => {
    const { service, userModel } = makeService();
    userModel.findOneAndUpdate.mockResolvedValue({ id: 'u1', isActive: true });

    await expect(service.confirmAccount('t1')).resolves.toEqual({
      success: true,
      message: 'Cuenta activada correctamente',
    });

    expect(userModel.findOneAndUpdate).toHaveBeenCalled();
  });

  it('throws when token is expired', async () => {
    const { service, userModel } = makeService();
    userModel.findOneAndUpdate.mockResolvedValue(null);
    userModel.findOne.mockResolvedValue({ id: 'u1', activationToken: 't-exp', tokenExpires: new Date(Date.now() - 1000) });

    await expect(service.confirmAccount('t-exp')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resends activation link for inactive user', async () => {
    const userDoc: any = {
      id: 'u1',
      email: 'a@b.com',
      nombreCompleto: 'User',
      isActive: false,
      save: jest.fn().mockResolvedValue(true),
    };

    const { service, userModel } = makeService({
      findOne: jest.fn().mockResolvedValue(userDoc),
    });

    // monkey-patch email service used internally
    (service as any).emailService = {
      sendConfirmationEmail: jest.fn().mockResolvedValue(true),
    };

    const res = await service.resendActivation('a@b.com');
    expect(res.success).toBe(true);
    expect((service as any).emailService.sendConfirmationEmail).toHaveBeenCalled();
    expect(userDoc.save).toHaveBeenCalled();
    expect(userDoc.activationToken).toBeTruthy();
    expect(userDoc.tokenExpires).toBeInstanceOf(Date);
  });
});
