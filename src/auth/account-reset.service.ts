import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';

import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { Cuenta, CuentaDocument } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Moneda, MonedaDocument } from '../moneda/schema/moneda.schema';
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
import { SupportTicket } from '../reports/schemas/support-ticket.schema';
import { PasswordReset } from './schemas/password-reset.schema';
import { AccountDeletion } from './schemas/account-deletion.schema';
import { CreditCard } from '../credit-card/schemas/credit-card.schema';
import { DashboardVersionService } from '../user/services/dashboard-version.service';

@Injectable()
export class AccountResetService {
  private readonly logger = new Logger(AccountResetService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
    @InjectModel(Moneda.name) private readonly monedaModel: Model<MonedaDocument>,
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
    @InjectModel(SupportTicket.name) private readonly supportTicketModel: Model<any>,
    @InjectModel(PasswordReset.name) private readonly passwordResetModel: Model<any>,
    @InjectModel(AccountDeletion.name) private readonly accountDeletionModel: Model<any>,
    @InjectModel(CreditCard.name) private readonly creditCardModel: Model<any>,
    @InjectConnection() private readonly connection: Connection,
    private readonly dashboardVersionService: DashboardVersionService,
  ) {}

  private async generateUniqueAccountId(): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    let exists: CuentaDocument | null = null;

    do {
      id = '';
      for (let i = 0; i < 7; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      exists = await this.cuentaModel.findOne({ id });
    } while (exists);

    return id;
  }

  private async getPrincipalCurrencySymbol(currencyCode: string): Promise<string> {
    const moneda = await this.monedaModel.findOne({ codigo: currencyCode });
    if (!moneda) {
      throw new BadRequestException(`La moneda ${currencyCode} no existe`);
    }
    return moneda.simbolo;
  }

  async resetAccountFromZero(userId: string, currentPassword: string) {
    const user = await this.userModel.findOne({ id: userId });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const passwordOk = await bcrypt.compare(currentPassword, user.password);
    if (!passwordOk) {
      throw new BadRequestException('La contraseña actual es incorrecta.');
    }

    const principalCurrency = user.monedaPrincipal || 'MXN';
    const principalSymbol = await this.getPrincipalCurrencySymbol(principalCurrency);

    const summary = {
      cuentasSecundariasEliminadas: 0,
      subcuentasEliminadas: 0,
      historialCuentasEliminado: 0,
      historialSubcuentasEliminado: 0,
      transaccionesEliminadas: 0,
      recurrentesEliminados: 0,
      historialRecurrentesEliminado: 0,
      conceptosEliminados: 0,
      metasEliminadas: 0,
      eventosMetaEliminados: 0,
      transferenciasInternasEliminadas: 0,
      ticketsEliminados: 0,
      tarjetasCreditoEliminadas: 0,
      ticketsSoporteEliminados: 0,
      passwordResetsEliminados: 0,
      solicitudesEliminacionEliminadas: 0,
    };

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        let principalAccount = await this.cuentaModel.findOne({ userId, isPrincipal: true }).session(session);

        if (!principalAccount) {
          const createdPrincipalAccount = new this.cuentaModel({
            id: await this.generateUniqueAccountId(),
            userId,
            nombre: 'Cuenta Principal',
            moneda: principalCurrency,
            cantidad: 0,
            simbolo: principalSymbol,
            color: '#EF6C00',
            isPrincipal: true,
            allowOverdraft: false,
            overdraftLimit: null,
          });
          await createdPrincipalAccount.save({ session });
          principalAccount = createdPrincipalAccount;
        }

        if (!principalAccount) {
          throw new NotFoundException('No se pudo inicializar la cuenta principal');
        }

        const principalAccountId = principalAccount._id;

        const filter = { userId };

        const [
          secondaryAccountsResult,
          subcuentasResult,
          cuentaHistorialResult,
          subcuentaHistorialResult,
          transaccionesResult,
          recurrentesResult,
          historialRecurrentesResult,
          conceptosResult,
          metasResult,
          metaEventosResult,
          transferenciasInternasResult,
          ticketsResult,
          tarjetasCreditoResult,
          supportTicketsResult,
          passwordResetResult,
          accountDeletionResult,
        ] = await Promise.all([
          this.cuentaModel.deleteMany({ userId, isPrincipal: { $ne: true } }).session(session),
          this.subcuentaModel.deleteMany(filter).session(session),
          this.cuentaHistorialModel.deleteMany(filter).session(session),
          this.subcuentaHistorialModel.deleteMany(filter).session(session),
          this.transactionModel.deleteMany(filter).session(session),
          this.recurrenteModel.deleteMany(filter).session(session),
          this.historialRecurrenteModel.deleteMany(filter).session(session),
          this.conceptoModel.deleteMany(filter).session(session),
          this.metaModel.deleteMany(filter).session(session),
          this.metaEventoModel.deleteMany(filter).session(session),
          this.internalTransferModel.deleteMany(filter).session(session),
          this.ticketScanModel.deleteMany(filter).session(session),
          this.creditCardModel.deleteMany(filter).session(session),
          this.supportTicketModel.deleteMany(filter).session(session),
          this.passwordResetModel.deleteMany(filter).session(session),
          this.accountDeletionModel.deleteMany(filter).session(session),
        ]);

        summary.cuentasSecundariasEliminadas = secondaryAccountsResult.deletedCount ?? 0;
        summary.subcuentasEliminadas = subcuentasResult.deletedCount ?? 0;
        summary.historialCuentasEliminado = cuentaHistorialResult.deletedCount ?? 0;
        summary.historialSubcuentasEliminado = subcuentaHistorialResult.deletedCount ?? 0;
        summary.transaccionesEliminadas = transaccionesResult.deletedCount ?? 0;
        summary.recurrentesEliminados = recurrentesResult.deletedCount ?? 0;
        summary.historialRecurrentesEliminado = historialRecurrentesResult.deletedCount ?? 0;
        summary.conceptosEliminados = conceptosResult.deletedCount ?? 0;
        summary.metasEliminadas = metasResult.deletedCount ?? 0;
        summary.eventosMetaEliminados = metaEventosResult.deletedCount ?? 0;
        summary.transferenciasInternasEliminadas = transferenciasInternasResult.deletedCount ?? 0;
        summary.ticketsEliminados = ticketsResult.deletedCount ?? 0;
        summary.tarjetasCreditoEliminadas = tarjetasCreditoResult.deletedCount ?? 0;
        summary.ticketsSoporteEliminados = supportTicketsResult.deletedCount ?? 0;
        summary.passwordResetsEliminados = passwordResetResult.deletedCount ?? 0;
        summary.solicitudesEliminacionEliminadas = accountDeletionResult.deletedCount ?? 0;

        const db = this.connection.db!;
        const relatedCollections = [
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
          'sharedanalyticssnapshots',
          'sharedcategories',
          'blocs',
          'blocitems',
          'blocliquidations',
        ];

        await Promise.all(
          relatedCollections.map((collectionName) =>
            db.collection(collectionName).deleteMany(
              {
                $or: [
                  { userId },
                  { ownerUserId: userId },
                  { createdByUserId: userId },
                  { actorUserId: userId },
                  { invitedUserId: userId },
                  { createdBy: userId },
                ],
              },
              { session },
            ),
          ),
        );

        await this.cuentaModel.updateOne(
          { _id: principalAccountId },
          {
            $set: {
              nombre: 'Cuenta Principal',
              moneda: principalCurrency,
              cantidad: 0,
              simbolo: principalSymbol,
              color: '#EF6C00',
              isPrincipal: true,
              allowOverdraft: false,
              overdraftLimit: null,
            },
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    await this.dashboardVersionService.touchDashboard(userId, 'auth.account_reset');
    this.logger.log(`Cuenta restaurada a cero para userId=${userId}`);

    return {
      ok: true,
      message:
        'La cuenta fue restaurada desde cero. Se conservó tu usuario y una sola cuenta principal en 0.',
      summary,
    };
  }
}
