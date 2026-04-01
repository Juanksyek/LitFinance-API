import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { ActivationController } from './activation.controller';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';
import { EmailModule } from '../email/email.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CuentaModule } from '../cuenta/cuenta.module';
import { MonedaModule } from '../moneda/moneda.module';
import { UserSession, UserSessionSchema } from './schemas/user-session.schema';
import { PasswordReset, PasswordResetSchema } from './schemas/password-reset.schema';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetController } from './password-reset.controller';
import { AccountDeletion, AccountDeletionSchema } from './schemas/account-deletion.schema';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionController } from './account-deletion.controller';

// Schemas necesarios para cascade delete
import { Cuenta, CuentaSchema } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Transaction, TransactionSchema } from '../transactions/schemas/transaction.schema/transaction.schema';
import { CuentaHistorial, CuentaHistorialSchema } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { Subcuenta, SubcuentaSchema } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { SubcuentaHistorial, SubcuentaHistorialSchema } from '../subcuenta/schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { Recurrente, RecurrenteSchema } from '../recurrentes/schemas/recurrente.schema';
import { HistorialRecurrente, HistorialRecurrenteSchema } from '../recurrentes/schemas/historial-recurrente.schema';
import { ConceptoPersonalizado, ConceptoPersonalizadoSchema } from '../conceptos/schemas/concepto-personalizado.schema';
import { Meta, MetaSchema } from '../goals/schemas/meta.schema';
import { MetaEvento, MetaEventoSchema } from '../goals/schemas/meta-evento.schema';
import { InternalTransfer, InternalTransferSchema } from '../goals/schemas/internal-transfer.schema';
import { TicketScan, TicketScanSchema } from '../ticket-scan/schemas/ticket-scan.schema';
import { DispositivoUsuario, DispositivoUsuarioSchema } from '../notificaciones/schemas/dispositivo-usuario.schema';
import { SupportTicket, SupportTicketSchema } from '../reports/schemas/support-ticket.schema';

@Module({
  imports: [
    UserModule,
    MongooseModule.forFeature([
      { name: UserSession.name, schema: UserSessionSchema },
      { name: PasswordReset.name, schema: PasswordResetSchema },
      { name: AccountDeletion.name, schema: AccountDeletionSchema },
      // Modelos para cascade delete
      { name: Cuenta.name, schema: CuentaSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: CuentaHistorial.name, schema: CuentaHistorialSchema },
      { name: Subcuenta.name, schema: SubcuentaSchema },
      { name: SubcuentaHistorial.name, schema: SubcuentaHistorialSchema },
      { name: Recurrente.name, schema: RecurrenteSchema },
      { name: HistorialRecurrente.name, schema: HistorialRecurrenteSchema },
      { name: ConceptoPersonalizado.name, schema: ConceptoPersonalizadoSchema },
      { name: Meta.name, schema: MetaSchema },
      { name: MetaEvento.name, schema: MetaEventoSchema },
      { name: InternalTransfer.name, schema: InternalTransferSchema },
      { name: TicketScan.name, schema: TicketScanSchema },
      { name: DispositivoUsuario.name, schema: DispositivoUsuarioSchema },
      { name: SupportTicket.name, schema: SupportTicketSchema },
    ]),
    EmailModule,
    CuentaModule,
    MonedaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
  ],
  controllers: [AuthController, ActivationController, PasswordResetController, AccountDeletionController],
  providers: [AuthService, JwtStrategy, PasswordResetService, AccountDeletionService],
  exports: [AuthService],
})
export class AuthModule {}
