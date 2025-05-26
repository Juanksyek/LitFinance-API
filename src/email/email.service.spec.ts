import { EmailService } from './email.service';
import { Resend } from 'resend';

jest.mock('resend');

describe('EmailService', () => {
  let service: EmailService;
  let mockSend: jest.Mock;

  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ id: 'mock-id' });

    (Resend as jest.Mock).mockImplementation(() => ({
      emails: { send: mockSend },
    }));

    service = new EmailService();
  });

  it('should send confirmation email correctly', async () => {
    process.env.FRONTEND_URL = 'https://litfinance.com/confirm/';
    const to = 'test@example.com';
    const token = 'abc123';
    const nombre = 'Juan';

    await service.sendConfirmationEmail(to, token, nombre);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to,
        subject: 'Confirma tu cuenta',
        html: expect.stringContaining('Hola Juan'),
      })
    );
  });

  it('should send reset password email correctly', async () => {
    process.env.FRONTEND_RESET_URL = 'https://litfinance.com/reset/';
    const to = 'reset@example.com';
    const token = 'reset456';
    const nombre = 'Carlos';

    await service.sendResetPasswordEmail(to, token, nombre);

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to,
        subject: 'Recuperar contraseña',
        html: expect.stringContaining('Hola Carlos'),
      })
    );
  });
});
