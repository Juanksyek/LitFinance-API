import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private resend = new Resend(process.env.RESEND_API_KEY);

  async sendConfirmationEmail(to: string, token: string, nombre: string) {
    const baseUrl = process.env.APP_URL || process.env.FRONTEND_URL;
    const confirmUrl = `${baseUrl}/activate/${token}`;
    await this.resend.emails.send({
      from: 'LitFinance <no-reply@thelitfinance.com>',
      to,
      subject: 'Confirma tu cuenta',
      html: `
      <!doctype html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Confirma tu cuenta</title>
          <style>
            :root { --brand: #ef7725; --bg: #ffffff; --muted: #6b6b6b; --card: #f7f7f7; }
            body { margin:0; padding:0; background:var(--bg); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; color:#111; }
            .container { max-width:680px; margin:24px auto; padding:24px; }
            .card { background:var(--card); border-radius:12px; overflow:hidden; box-shadow:0 6px 18px rgba(14,14,14,0.06); }
            .header { background: linear-gradient(90deg, var(--brand) 0%, #ff9b5a 100%); padding:28px; color:#fff; }
            .logo { font-weight:700; font-size:20px; letter-spacing:0.3px; }
            .content { padding:28px; }
            h1 { margin:0 0 8px; font-size:20px; }
            p { margin:0 0 14px; color:var(--muted); line-height:1.5; }
            .button { display:inline-block; background:var(--brand); color:#fff; text-decoration:none; padding:12px 20px; border-radius:8px; font-weight:600; }
            .small { font-size:13px; color:#8a8a8a; }
            .footer { padding:16px 28px; font-size:13px; color:#9a9a9a; }
            @media (max-width:520px) {
              .container { padding:12px; }
              .content { padding:18px; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="card">
              <div class="header">
                <div class="logo">
                  <img src="${baseUrl}/public/images/LitFinance.png" alt="LitFinance" style="height:36px; display:block;" />
                </div>
              </div>
              <div class="content">
                <h1>Hola ${nombre},</h1>
                <p>¡Gracias por registrarte en <strong>LitFinance</strong>! Para activar tu cuenta, haz clic en el botón de abajo. Si no creaste una cuenta, puedes ignorar este correo.</p>
                <p style="text-align:center; margin:22px 0;">
                  <a href="${confirmUrl}" class="button">Confirmar cuenta</a>
                </p>
                <p class="small">Este enlace expirará en 30 minutos. Si tienes problemas, copia y pega la siguiente URL en tu navegador:</p>
                <p class="small" style="word-break:break-all;">${confirmUrl}</p>
              </div>
              <div class="footer">¿Necesitas ayuda? Responde este correo o visita nuestra ayuda en línea.</div>
            </div>
          </div>
        </body>
      </html>
      `,
    });
  }

  // Enviar código para restablecer la contraseña
  async sendResetPasswordCode(to: string, code: string, nombre: string) {
    const baseUrl = process.env.APP_URL || process.env.FRONTEND_URL;
    await this.resend.emails.send({
      from: 'LitFinance <no-reply@thelitfinance.com>',
      to,
      subject: 'Código para recuperar contraseña',
      html: `
      <!doctype html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Código para restablecer contraseña</title>
          <style>
            :root { --brand: #ef7725; --bg:#ffffff; --muted:#6b6b6b; --card:#fbfbfb }
            body{ margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; color:#111 }
            .wrap{ max-width:640px; margin:24px auto; padding:20px }
            .card{ background:var(--card); border-radius:12px; box-shadow:0 6px 18px rgba(0,0,0,0.06); overflow:hidden }
            .header{ background: linear-gradient(90deg,var(--brand), #ff9b5a); padding:22px; color:#fff }
            .logo{ font-weight:700; font-size:18px }
            .body{ padding:22px }
            h1{ margin:0 0 6px; font-size:18px }
            p{ margin:0 0 12px; color:var(--muted) }
            .code{ display:inline-block; padding:14px 18px; font-size:1.6rem; letter-spacing:8px; background:#fff; border-radius:8px; font-weight:700; color:var(--brand); box-shadow:inset 0 -4px 0 rgba(0,0,0,0.02) }
            .small{ font-size:13px; color:#8a8a8a }
            @media (max-width:520px){ .wrap{ padding:12px } .body{ padding:18px } .code{ font-size:1.4rem; padding:12px 16px } }
          </style>
        </head>
        <body>
          <div class="wrap">
              <div class="card">
              <div class="header"><div class="logo"><img src="${baseUrl}/public/images/LitFinance.png" alt="LitFinance" style="height:32px; display:block;" /></div></div>
              <div class="body">
                <h1>Hola ${nombre},</h1>
                <p>Usa el siguiente código para restablecer tu contraseña. Este código expirará en 10 minutos.</p>
                <p style="text-align:center; margin:20px 0;"><span class="code">${code}</span></p>
                <p class="small">Si no solicitaste un cambio de contraseña, puedes ignorar este correo o contactar soporte.</p>
              </div>
              <div class="footer" style="padding:12px 22px; font-size:13px; color:#9a9a9a">¿Necesitas ayuda? Responde este correo.</div>
            </div>
          </div>
        </body>
      </html>
      `,
    });
  }
}
// commit