import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema/user.schema';
import { Cuenta, CuentaDocument } from '../../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaDocument } from '../../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { CuentaHistorial, CuentaHistorialDocument } from '../../cuenta-historial/schemas/cuenta-historial.schema';
import { Transaction, TransactionDocument } from '../../transactions/schemas/transaction.schema/transaction.schema';

@Injectable()
export class CleanupService {
    private readonly logger = new Logger(CleanupService.name);

    constructor(
        @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
        @InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
        @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<SubcuentaDocument>,
        @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
        @InjectModel(CuentaHistorial.name) private readonly historialModel: Model<CuentaHistorialDocument>,
    ) { }

    // Método existente: No se modifica
    async deleteInactiveUsers() {
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

        const result = await this.userModel.deleteMany({
            lastActivityAt: { $lt: twelveMonthsAgo },
        });

        this.logger.log(`Usuarios eliminados por inactividad: ${result.deletedCount}`);
        return { deletedUsers: result.deletedCount };
    }

    // Nuevo método: Limpieza de cuentas relacionadas con un usuario
    async cleanupAccount(userId: string, cuentaId: string) {
        // Verificar si la cuenta existe
        const cuenta = await this.cuentaModel.findOne({ _id: cuentaId, userId });
        if (!cuenta) {
            throw new NotFoundException('Cuenta no encontrada');
        }

        // Eliminar historial relacionado con la cuenta
        const historialResult = await this.historialModel.deleteMany({ cuentaId });
        this.logger.log(`Historial eliminado: ${historialResult.deletedCount} registros`);

        // Eliminar subcuentas relacionadas con la cuenta
        const subcuentasResult = await this.subcuentaModel.deleteMany({ cuentaId });
        this.logger.log(`Subcuentas eliminadas: ${subcuentasResult.deletedCount}`);

        // Eliminar transacciones relacionadas con la cuenta
        const transaccionesResult = await this.transactionModel.deleteMany({ cuentaId });
        this.logger.log(`Transacciones eliminadas: ${transaccionesResult.deletedCount}`);

        // Dejar los montos de la cuenta en ceros
        cuenta.cantidad = 0;
        await cuenta.save();
        this.logger.log(`Cuenta ${cuentaId} reseteada a cero`);

        return {
            historialEliminado: historialResult.deletedCount,
            subcuentasEliminadas: subcuentasResult.deletedCount,
            transaccionesEliminadas: transaccionesResult.deletedCount,
            cuentaReseteada: true,
        };
    }
}