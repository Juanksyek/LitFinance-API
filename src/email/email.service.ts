import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
    private resend = new Resend(process.env.RESEND_API_KEY);

    async sendConfirmationEmail(to: string, token: string, nombre: string) {
        const confirmUrl = `${process.env.FRONTEND_URL}${token}`;
        await this.resend.emails.send({
            from: 'LitFinance <no-reply@thelitfinance.com>',
            to,
            subject: 'Confirma tu cuenta',
            html: `
        <h2>Hola ${nombre}</h2>
        <p>Gracias por registrarte en LitFinance App.</p>
        <p>Para activar tu cuenta, da clic en el siguiente botón:</p>
        <a href="${confirmUrl}" style="background-color:#53F29D;padding:10px 15px;border-radius:5px;text-decoration:none;color:#000;">Confirmar cuenta</a>
        <p>Este enlace expirará en 30 minutos.</p>
      `,
        });
    }

    async sendResetPasswordCode(to: string, code: string, nombre: string) {
        await this.resend.emails.send({
            from: 'LitFinance <no-reply@thelitfinance.com>',
            to,
            subject: 'Código para recuperar contraseña',
            html: `
        <h2>Hola ${nombre}</h2>
        <p>Tu código para restablecer la contraseña es:</p>
        <div style="font-size: 2rem; letter-spacing: 6px; margin: 20px 0; font-weight: bold;">
          ${code}
        </div>
        <p>Este código expirará en 10 minutos.</p>
      `,
        });
    }
}
