import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import { AccountDeletion, AccountDeletionDocument } from './schemas/account-deletion.schema';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { EmailService } from '../email/email.service';

// Schemas para cascade delete
import { Cuenta } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Transaction } from '../transactions/schemas/transaction.schema/transaction.schema';
import { CuentaHistorial } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { Subcuenta } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { SubcuentaHistorial } from '../subcuenta/schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { Recurrente } from '../recurrentes/schemas/recurrente.schema';
import { HistorialRecurrente } from '../recurrentes/schemas/historial-recurrente.schema';
import { ConceptoPersonalizado } from '../conceptos/schemas/concepto-personalizado.schema';
import { Meta } from '../goals/schemas/meta.schema';
import { MetaEvento } from '../goals/schemas/meta-evento.schema';
import { InternalTransfer } from '../goals/schemas/internal-transfer.schema';
import { TicketScan } from '../ticket-scan/schemas/ticket-scan.schema';
import { DispositivoUsuario } from '../notificaciones/schemas/dispositivo-usuario.schema';
import { SupportTicket } from '../reports/schemas/support-ticket.schema';
import { UserSession } from './schemas/user-session.schema';
import { PasswordReset } from './schemas/password-reset.schema';

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  private readonly stripe: Stripe;

  private OTP_LENGTH = 6;
  private OTP_TTL_MINUTES = 10;
  private MAX_ATTEMPTS = 5;
  private LOCK_MINUTES = 15;
  private RESEND_COOLDOWN_SECONDS = 60;

  constructor(
    @InjectModel(AccountDeletion.name) private readonly deletionModel: Model<AccountDeletionDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<any>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<any>,
    @InjectModel(CuentaHistorial.name) private readonly cuentaHistorialModel: Model<any>,
    @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<any>,
    @InjectModel(SubcuentaHistorial.name) private readonly subcuentaHistorialModel: Model<any>,
    @InjectModel(Recurrente.name) private readonly recurrenteModel: Model<any>,
    @InjectModel(HistorialRecurrente.name) private readonly historialRecurrenteModel: Model<any>,
    @InjectModel(ConceptoPersonalizado.name) private readonly conceptoModel: Model<any>,
    @InjectModel(Meta.name) private readonly metaModel: Model<any>,
    @InjectModel(MetaEvento.name) private readonly metaEventoModel: Model<any>,
    @InjectModel(InternalTransfer.name) private readonly internalTransferModel: Model<any>,
    @InjectModel(TicketScan.name) private readonly ticketScanModel: Model<any>,
    @InjectModel(DispositivoUsuario.name) private readonly dispositivoModel: Model<any>,
    @InjectModel(SupportTicket.name) private readonly supportTicketModel: Model<any>,
    @InjectModel(UserSession.name) private readonly userSessionModel: Model<any>,
    @InjectModel(PasswordReset.name) private readonly passwordResetModel: Model<any>,
    @InjectConnection() private readonly connection: Connection,
    private readonly emailService: EmailService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.stripe = new Stripe(this.configService.get<string>('STRIPE_SECRET_KEY')!, {
      apiVersion: (process.env.STRIPE_API_VERSION as any) || '2024-06-20',
    });
  }

  /* ────────── Helpers ────────── */

  private normalizeEmail(email: string) {
    return (email || '').trim().toLowerCase();
  }

  private generateOtp(): string {
    const min = 10 ** (this.OTP_LENGTH - 1);
    const max = 10 ** this.OTP_LENGTH - 1;
    return String(randomInt(min, max + 1)).padStart(this.OTP_LENGTH, '0');
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

  private buildDeletionToken(payload: { email: string; userId: string; deletionId: string }) {
    return this.jwtService.sign(
      {
        sub: payload.userId,
        email: payload.email,
        did: payload.deletionId,
        purpose: 'account_deletion',
      },
      {
        expiresIn: '15m',
        secret: this.configService.get<string>('JWT_SECRET'),
      },
    );
  }

  /* ────────── Step 1: Solicitar OTP ────────── */

  async requestOtp(userId: string): Promise<{ ok: true; message: string }> {
    const user = await this.userModel.findOne({ id: userId }).lean();
    if (!user) throw new BadRequestException('Usuario no encontrado');

    const email = this.normalizeEmail(user.email);

    // Cooldown check
    const active = await this.deletionModel.findOne({
      email,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (active?.lockedUntil && active.lockedUntil > new Date()) {
      return { ok: true, message: 'Se ha enviado un código de verificación a tu correo electrónico' };
    }

    if (active?.lastSentAt) {
      const elapsed = (Date.now() - new Date(active.lastSentAt).getTime()) / 1000;
      if (elapsed < this.RESEND_COOLDOWN_SECONDS) {
        return { ok: true, message: 'Se ha enviado un código de verificación a tu correo electrónico' };
      }
    }

    // Invalidate previous requests
    await this.deletionModel.updateMany(
      { email, consumedAt: null },
      { $set: { consumedAt: new Date() } },
    );

    const otp = this.generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);

    await this.deletionModel.create({
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

    // Enviar correo de confirmación
    await this.emailService['resend'].emails.send({
      from: 'LitFinance <no-reply@thelitfinance.com>',
      to: email,
      subject: '⚠️ Código de confirmación para eliminar tu cuenta - LitFinance',
      html: this.buildDeletionEmailHtml(otp, user.nombreCompleto || 'Usuario'),
    });

    return { ok: true, message: 'Se ha enviado un código de verificación a tu correo electrónico' };
  }

  /* ────────── Step 2: Verificar OTP ────────── */

  async verifyOtp(userId: string, otpRaw: string): Promise<{ deletionToken: string }> {
    const user = await this.userModel.findOne({ id: userId }).lean();
    if (!user) throw new BadRequestException('Usuario no encontrado');

    const email = this.normalizeEmail(user.email);
    const otp = (otpRaw || '').trim();

    if (!otp) throw new BadRequestException('Código requerido');

    const deletion = await this.deletionModel.findOne({
      email,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!deletion) throw new UnauthorizedException('Código inválido o expirado');

    if (deletion.lockedUntil && deletion.lockedUntil > new Date()) {
      throw new HttpException('Demasiados intentos. Intenta más tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const ok = await bcrypt.compare(otp, deletion.otpHash);
    if (!ok) {
      const nextAttempts = (deletion.attempts ?? 0) + 1;

      if (nextAttempts >= this.MAX_ATTEMPTS) {
        deletion.attempts = nextAttempts;
        deletion.lockedUntil = this.lockUntil();
        await deletion.save();
        throw new HttpException('Demasiados intentos. Intenta más tarde.', HttpStatus.TOO_MANY_REQUESTS);
      }

      deletion.attempts = nextAttempts;
      await deletion.save();
      throw new UnauthorizedException('Código inválido');
    }

    // OTP correcto
    deletion.consumedAt = new Date();
    await deletion.save();

    const deletionToken = this.buildDeletionToken({
      email,
      userId: String(user.id),
      deletionId: String(deletion._id),
    });

    return { deletionToken };
  }

  /* ────────── Step 3: Confirmar eliminación ────────── */

  async confirmDeletion(deletionToken: string): Promise<{ ok: true; message: string }> {
    if (!deletionToken) throw new BadRequestException('Token requerido');

    let decoded: any;
    try {
      decoded = this.jwtService.verify(deletionToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (decoded?.purpose !== 'account_deletion' || !decoded?.did || !decoded?.sub) {
      throw new UnauthorizedException('Token inválido');
    }

    const deletion = await this.deletionModel.findById(decoded.did);
    if (!deletion) throw new UnauthorizedException('Token inválido');

    if (!deletion.consumedAt) throw new UnauthorizedException('Primero verifica tu código');
    if (deletion.expiresAt < new Date()) throw new UnauthorizedException('Token expirado');

    const userId = String(decoded.sub);
    const user = await this.userModel.findOne({ id: userId });
    if (!user) throw new BadRequestException('Usuario no encontrado');

    // Cancelar suscripción Stripe si existe
    await this.cancelStripeSubscription(user);

    // Cascade delete dentro de una transacción MongoDB
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const filter = { userId };

        await Promise.all([
          this.transactionModel.deleteMany(filter).session(session),
          this.cuentaHistorialModel.deleteMany(filter).session(session),
          this.subcuentaHistorialModel.deleteMany(filter).session(session),
          this.subcuentaModel.deleteMany(filter).session(session),
          this.cuentaModel.deleteMany(filter).session(session),
          this.recurrenteModel.deleteMany(filter).session(session),
          this.historialRecurrenteModel.deleteMany(filter).session(session),
          this.conceptoModel.deleteMany(filter).session(session),
          this.metaModel.deleteMany(filter).session(session),
          this.metaEventoModel.deleteMany(filter).session(session),
          this.internalTransferModel.deleteMany(filter).session(session),
          this.ticketScanModel.deleteMany(filter).session(session),
          this.dispositivoModel.deleteMany(filter).session(session),
          this.supportTicketModel.deleteMany(filter).session(session),
          this.userSessionModel.deleteMany(filter).session(session),
          this.passwordResetModel.deleteMany({ userId }).session(session),
          this.deletionModel.deleteMany({ userId }).session(session),
        ]);

        // Eliminar colecciones shared/blocs por nombre (evita importar todos los schemas)
        const db = this.connection.db!;
        const sharedCollections = [
          'sharedspaces',
          'sharedspacemembers',
          'sharedmovements',
          'sharedmovementsplits',
          'sharedmovementcontributions',
          'sharednotifications',
          'sharedaccountimpacts',
          'sharedinvitations',
          'sharedauditlogs',
          'sharedsplitrules',
          'blocs',
          'blocitems',
          'blocliquidations',
        ];

        await Promise.all(
          sharedCollections.map(async (col) => {
            const collection = db.collection(col);
            // Cada colección puede tener userId, ownerUserId, actorUserId, etc.
            await collection.deleteMany({
              $or: [
                { userId },
                { ownerUserId: userId },
                { createdByUserId: userId },
                { actorUserId: userId },
                { invitedUserId: userId },
                { createdBy: userId },
              ],
            }, { session });
          }),
        );

        // Finalmente eliminar al usuario
        await this.userModel.deleteOne({ id: userId }).session(session);
      });
    } finally {
      session.endSession();
    }

    this.logger.log(`Cuenta eliminada: userId=${userId}, email=${user.email}`);

    return { ok: true, message: 'Tu cuenta y todos tus datos han sido eliminados permanentemente' };
  }

  /* ────────── Stripe ────────── */

  private async cancelStripeSubscription(user: any): Promise<void> {
    try {
      if (!user.stripeCustomerId) return;

      const subscriptions = await this.stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: 'active',
      });

      for (const sub of subscriptions.data) {
        await this.stripe.subscriptions.cancel(sub.id);
        this.logger.log(`Stripe subscription ${sub.id} cancelada para userId=${user.id}`);
      }
    } catch (err) {
      // No bloquear la eliminación por un error de Stripe
      this.logger.error(`Error cancelando Stripe para userId=${user.id}: ${err.message}`);
    }
  }

  /* ────────── Email HTML ────────── */

  private buildDeletionEmailHtml(otp: string, nombre: string): string {
    const baseUrl = process.env.APP_URL || process.env.FRONTEND_URL;
    return `
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Confirmar eliminación de cuenta</title>
        <style>
          :root { --brand: #ef7725; --danger: #dc3545; --bg:#ffffff; --muted:#6b6b6b; --card:#fbfbfb }
          body{ margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; color:#111 }
          .wrap{ max-width:640px; margin:24px auto; padding:20px }
          .card{ background:var(--card); border-radius:12px; box-shadow:0 6px 18px rgba(0,0,0,0.06); overflow:hidden }
          .header{ background: linear-gradient(90deg, var(--danger), #ff6b6b); padding:22px; color:#fff }
          .logo{ font-weight:700; font-size:18px }
          .body{ padding:22px }
          h1{ margin:0 0 6px; font-size:18px }
          p{ margin:0 0 12px; color:var(--muted) }
          .code{ display:inline-block; padding:14px 18px; font-size:1.6rem; letter-spacing:8px; background:#fff; border-radius:8px; font-weight:700; color:var(--danger); box-shadow:inset 0 -4px 0 rgba(0,0,0,0.02) }
          .small{ font-size:13px; color:#8a8a8a }
          .warning{ background:#fff3cd; border-left:4px solid #ffc107; padding:14px; border-radius:0 6px 6px 0; margin:16px 0 }
          .warning p{ color:#856404; margin:0; font-size:14px }
          @media (max-width:520px){ .wrap{ padding:12px } .body{ padding:18px } .code{ font-size:1.4rem; padding:12px 16px } }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="card">
            <div class="header">
              <div class="logo">
                <img src="${baseUrl}/public/images/LitFinance.png" alt="LitFinance" style="height:32px; display:block;" />
              </div>
            </div>
            <div class="body">
              <h1>Hola ${nombre},</h1>
              <p>Recibimos una solicitud para <strong>eliminar permanentemente</strong> tu cuenta de LitFinance.</p>
              
              <div class="warning">
                <p><strong>⚠️ Esta acción es irreversible.</strong> Se eliminarán todas tus cuentas, transacciones, metas, recurrentes, historial y demás datos asociados.</p>
              </div>
              
              <p>Si deseas continuar, usa el siguiente código de confirmación:</p>
              <p style="text-align:center; margin:20px 0;"><span class="code">${otp}</span></p>
              <p class="small">Este código expira en ${this.OTP_TTL_MINUTES} minutos.</p>
              <p class="small">Si no solicitaste esta eliminación, ignora este correo. Tu cuenta seguirá segura.</p>
            </div>
          </div>
        </div>
      </body>
    </html>
    `;
  }
}
