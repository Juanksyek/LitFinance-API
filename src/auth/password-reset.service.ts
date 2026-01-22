import { Injectable, BadRequestException, UnauthorizedException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { PasswordReset, PasswordResetDocument } from './schemas/password-reset.schema';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { EmailService } from '../email/email.service';

type VerifyResult = { resetToken: string };

@Injectable()
export class PasswordResetService {
  private OTP_LENGTH = 6;
  private OTP_TTL_MINUTES = 10;
  private MAX_ATTEMPTS = 5;
  private LOCK_MINUTES = 15;
  private RESEND_COOLDOWN_SECONDS = 60;

  constructor(
    @InjectModel(PasswordReset.name) private readonly resetModel: Model<PasswordResetDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly emailService: EmailService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private normalizeEmail(email: string) {
    return (email || '').trim().toLowerCase();
  }

  private generateOtp(): string {
    // 6 dígitos, incluye ceros al inicio
    const min = 10 ** (this.OTP_LENGTH - 1);
    const max = 10 ** this.OTP_LENGTH - 1;
    const n = randomInt(min, max + 1);
    return String(n).padStart(this.OTP_LENGTH, '0');
  }

  private otpExpiresAt(): Date {
    const d = new Date();
    d.setMinutes(d.getMinutes() + this.OTP_TTL_MINUTES);
    return d;
  }

  private lockUntil(): Date {
    const d = new Date();
    d.setMinutes(d.getMinutes() + this.LOCK_MINUTES);
    return d;
  }

  private buildResetToken(payload: { email: string; userId: string; resetId: string }) {
    // JWT corto SOLO para reset.
    // IMPORTANTE: agrega un claim "purpose" para evitar reutilización en otros flows.
    return this.jwtService.sign(
      {
        sub: payload.userId,
        email: payload.email,
        rid: payload.resetId,
        purpose: 'password_reset',
      },
      { 
        expiresIn: '15m',
        secret: this.configService.get<string>('JWT_SECRET'),
      },
    );
  }

  /**
   * Crea y envía OTP. Responde OK siempre para no filtrar si existe el email.
   */
  async requestOtp(emailRaw: string): Promise<{ ok: true; message: string }> {
    const email = this.normalizeEmail(emailRaw);
    if (!email) throw new BadRequestException('Email inválido');

    // Busca usuario (pero NO reveles si existe).
    const user = await this.userModel.findOne({ email }).lean();

    // Siempre responde ok, pero solo envía y guarda si existe.
    if (!user) {
      return { 
        ok: true, 
        message: 'Si el email existe, recibirás un código de verificación' 
      };
    }

    // Si hay un reset activo, revisa cooldown de reenvío
    const active = await this.resetModel.findOne({
      email,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (active?.lockedUntil && active.lockedUntil > new Date()) {
      // bloqueado: igual responde ok para no filtrar
      return { 
        ok: true, 
        message: 'Si el email existe, recibirás un código de verificación' 
      };
    }

    if (active?.lastSentAt) {
      const elapsed = (Date.now() - new Date(active.lastSentAt).getTime()) / 1000;
      if (elapsed < this.RESEND_COOLDOWN_SECONDS) {
        // no "truene" el UX: responde ok, pero no reenvíes aún
        return { 
          ok: true, 
          message: 'Si el email existe, recibirás un código de verificación' 
        };
      }
    }

    // Invalida cualquier reset anterior (opcional pero recomendado)
    await this.resetModel.updateMany(
      { email, consumedAt: null },
      { $set: { consumedAt: new Date() } },
    );

    const otp = this.generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);

    await this.resetModel.create({
      email,
      userId: String(user.id),
      otpHash,
      expiresAt: this.otpExpiresAt(),
      attempts: 0,
      lockedUntil: null,
      consumedAt: null,
      lastSentAt: new Date(),
      resendCount: 0,
    });

    // Envía email con Resend
    await this.emailService['resend'].emails.send({
      from: 'LitFinance <no-reply@thelitfinance.com>',
      to: email,
      subject: '🔐 Código para restablecer tu contraseña - LitFinance',
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px;">
          <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #667eea; margin: 0; font-size: 28px;">🔐 Restablecer Contraseña</h1>
            </div>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Hola,
            </p>
            
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
              Recibimos una solicitud para restablecer tu contraseña. Utiliza el siguiente código:
            </p>
            
            <div style="background: #f8f9fa; padding: 25px; border-radius: 8px; text-align: center; margin: 30px 0; border-left: 4px solid #667eea;">
              <div style="font-size: 36px; letter-spacing: 12px; font-weight: 700; color: #667eea; font-family: 'Courier New', monospace;">
                ${otp}
              </div>
            </div>
            
            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px; margin: 20px 0;">
              <p style="margin: 0; color: #856404; font-size: 14px;">
                ⏱️ Este código expira en <strong>${this.OTP_TTL_MINUTES} minutos</strong>
              </p>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
              <p style="color: #666; font-size: 14px; line-height: 1.6; margin-bottom: 10px;">
                <strong>Consejos de seguridad:</strong>
              </p>
              <ul style="color: #666; font-size: 14px; line-height: 1.8; margin-left: 20px;">
                <li>No compartas este código con nadie</li>
                <li>Si no solicitaste este cambio, ignora este correo</li>
                <li>Tu cuenta permanecerá segura</li>
              </ul>
            </div>
            
            <div style="margin-top: 30px; padding: 20px; background: #f8f9fa; border-radius: 6px; text-align: center;">
              <p style="margin: 0; color: #999; font-size: 12px;">
                Este correo fue enviado desde <strong>LitFinance</strong>
              </p>
            </div>
          </div>
        </div>
      `,
    });

    return { 
      ok: true, 
      message: 'Si el email existe, recibirás un código de verificación' 
    };
  }

  /**
   * Verifica OTP y regresa resetToken corto.
   */
  async verifyOtp(emailRaw: string, otpRaw: string): Promise<VerifyResult> {
    const email = this.normalizeEmail(emailRaw);
    const otp = (otpRaw || '').trim();

    if (!email || !otp) throw new BadRequestException('Datos inválidos');

    const reset = await this.resetModel.findOne({
      email,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    });

    // No revelar si existe: pero aquí sí necesitas error para UX
    if (!reset) throw new UnauthorizedException('Código inválido o expirado');

    if (reset.lockedUntil && reset.lockedUntil > new Date()) {
      throw new HttpException('Demasiados intentos. Intenta más tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const ok = await bcrypt.compare(otp, reset.otpHash);
    if (!ok) {
      const nextAttempts = (reset.attempts ?? 0) + 1;

      // Si llega a max, lock
      if (nextAttempts >= this.MAX_ATTEMPTS) {
        reset.attempts = nextAttempts;
        reset.lockedUntil = this.lockUntil();
        await reset.save();
        throw new HttpException('Demasiados intentos. Intenta más tarde.', HttpStatus.TOO_MANY_REQUESTS);
      }

      reset.attempts = nextAttempts;
      await reset.save();
      throw new UnauthorizedException('Código inválido');
    }

    // OTP correcto: consumir
    reset.consumedAt = new Date();
    await reset.save();

    const resetToken = this.buildResetToken({
      email,
      userId: reset.userId,
      resetId: String(reset._id),
    });

    return { resetToken };
  }

  /**
   * Cambia contraseña usando resetToken.
   */
  async resetPassword(resetToken: string, newPassword: string): Promise<{ ok: true; message: string }> {
    if (!resetToken || !newPassword) throw new BadRequestException('Datos inválidos');

    let decoded: any;
    try {
      decoded = this.jwtService.verify(resetToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (decoded?.purpose !== 'password_reset' || !decoded?.rid || !decoded?.sub || !decoded?.email) {
      throw new UnauthorizedException('Token inválido');
    }

    const reset = await this.resetModel.findById(decoded.rid);
    if (!reset) throw new UnauthorizedException('Token inválido');

    // Asegura que coincide el email/userId del token
    if (reset.email !== this.normalizeEmail(decoded.email) || reset.userId !== String(decoded.sub)) {
      throw new UnauthorizedException('Token inválido');
    }

    // Asegura que ya se consumió OTP (flujo correcto)
    if (!reset.consumedAt) throw new UnauthorizedException('Primero verifica tu código');

    // Opcional: evita usar tokens muy viejos aunque JWT aún viva
    if (reset.expiresAt < new Date()) {
      throw new UnauthorizedException('Token expirado');
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await this.userModel.updateOne(
      { id: reset.userId },
      { $set: { password: hash } },
    );

    // Invalida el reset (por si intentan reusar token)
    await this.resetModel.updateOne(
      { _id: reset._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    return { 
      ok: true, 
      message: 'Contraseña actualizada correctamente' 
    };
  }
}
