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

    /**
     * Elimina completamente un usuario y TODOS sus datos relacionados
     * @param userId ID del usuario a eliminar
     * @returns Resumen de elementos eliminados
     */
    async deleteUserCompletely(userId: string) {
        this.logger.log(`Iniciando eliminación completa del usuario: ${userId}`);

        // Verificar que el usuario existe
        const user = await this.userModel.findOne({ id: userId });
        if (!user) {
            throw new NotFoundException('Usuario no encontrado');
        }

        const deletionSummary = {
            usuario: false,
            cuentas: 0,
            subcuentas: 0,
            historialCuentas: 0,
            transacciones: 0,
            historialSubcuentas: 0,
            recurrentes: 0,
            notificaciones: 0,
            goals: 0
        };

        try {
            // 1. Eliminar historial de cuentas
            const historialCuentasResult = await this.historialModel.deleteMany({ userId });
            deletionSummary.historialCuentas = historialCuentasResult.deletedCount;
            this.logger.log(`Historial de cuentas eliminado: ${historialCuentasResult.deletedCount}`);

            // 2. Eliminar transacciones
            const transaccionesResult = await this.transactionModel.deleteMany({ userId });
            deletionSummary.transacciones = transaccionesResult.deletedCount;
            this.logger.log(`Transacciones eliminadas: ${transaccionesResult.deletedCount}`);

            // 3. Eliminar subcuentas y su historial
            const subcuentasResult = await this.subcuentaModel.deleteMany({ userId });
            deletionSummary.subcuentas = subcuentasResult.deletedCount;
            this.logger.log(`Subcuentas eliminadas: ${subcuentasResult.deletedCount}`);

            // 4. Eliminar historial de subcuentas (si existe el modelo)
            try {
                const SubcuentaHistorial = this.subcuentaModel.db.model('SubcuentaHistorial');
                const historialSubcuentasResult = await SubcuentaHistorial.deleteMany({ userId });
                deletionSummary.historialSubcuentas = historialSubcuentasResult.deletedCount;
                this.logger.log(`Historial de subcuentas eliminado: ${historialSubcuentasResult.deletedCount}`);
            } catch (error) {
                this.logger.warn('No se pudo eliminar historial de subcuentas (modelo no encontrado)');
            }

            // 5. Eliminar recurrentes (si existe el modelo)
            try {
                const Recurrente = this.userModel.db.model('Recurrente');
                const recurrentesResult = await Recurrente.deleteMany({ userId });
                deletionSummary.recurrentes = recurrentesResult.deletedCount;
                this.logger.log(`Recurrentes eliminados: ${recurrentesResult.deletedCount}`);
            } catch (error) {
                this.logger.warn('No se pudo eliminar recurrentes (modelo no encontrado)');
            }

            // 6. Eliminar notificaciones (si existe el modelo)
            try {
                const Notificacion = this.userModel.db.model('Notificacion');
                const notificacionesResult = await Notificacion.deleteMany({ userId });
                deletionSummary.notificaciones = notificacionesResult.deletedCount;
                this.logger.log(`Notificaciones eliminadas: ${notificacionesResult.deletedCount}`);
            } catch (error) {
                this.logger.warn('No se pudo eliminar notificaciones (modelo no encontrado)');
            }

            // 7. Eliminar goals (si existe el modelo)
            try {
                const Goal = this.userModel.db.model('Goal');
                const goalsResult = await Goal.deleteMany({ userId });
                deletionSummary.goals = goalsResult.deletedCount;
                this.logger.log(`Goals eliminados: ${goalsResult.deletedCount}`);
            } catch (error) {
                this.logger.warn('No se pudo eliminar goals (modelo no encontrado)');
            }

            // 8. Eliminar cuentas principales
            const cuentasResult = await this.cuentaModel.deleteMany({ userId });
            deletionSummary.cuentas = cuentasResult.deletedCount;
            this.logger.log(`Cuentas eliminadas: ${cuentasResult.deletedCount}`);

            // 9. Finalmente, eliminar el usuario
            await this.userModel.deleteOne({ id: userId });
            deletionSummary.usuario = true;
            this.logger.log(`Usuario ${userId} eliminado completamente`);

            return {
                message: `Usuario ${userId} y todos sus datos han sido eliminados exitosamente`,
                summary: deletionSummary,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error(`Error durante la eliminación del usuario ${userId}:`, error);
            throw new Error(`Error al eliminar el usuario: ${error.message}`);
        }
    }

    /**
     * Formatea/resetea completamente los datos de un usuario pero mantiene la cuenta
     * Elimina: historial, transacciones, subcuentas, recurrentes, notificaciones, goals
     * Mantiene: usuario y cuenta principal (reseteada a 0)
     * @param userId ID del usuario a formatear
     * @returns Resumen de elementos eliminados
     */
    async formatUserAccount(userId: string) {
        this.logger.log(`Iniciando formateo de cuenta del usuario: ${userId}`);

        const user = await this.userModel.findOne({ id: userId });
        if (!user) {
            throw new NotFoundException('Usuario no encontrado');
        }

        // Verificar que tiene cuenta principal
        const cuentaPrincipal = await this.cuentaModel.findOne({ userId, isPrincipal: true });
        if (!cuentaPrincipal) {
            throw new NotFoundException('Cuenta principal no encontrada');
        }

        const formatSummary = {
            usuario: 'mantenido',
            cuentaPrincipal: 'reseteada',
            subcuentas: 0,
            historialCuentas: 0,
            transacciones: 0,
            historialSubcuentas: 0,
            recurrentes: 0,
            notificaciones: 0,
            goals: 0
        };

        try {
            // 1. Eliminar historial de cuentas
            const historialCuentasResult = await this.historialModel.deleteMany({ userId });
            formatSummary.historialCuentas = historialCuentasResult.deletedCount;
            this.logger.log(`Historial de cuentas eliminado: ${historialCuentasResult.deletedCount}`);

            // 2. Eliminar transacciones
            const transaccionesResult = await this.transactionModel.deleteMany({ userId });
            formatSummary.transacciones = transaccionesResult.deletedCount;
            this.logger.log(`Transacciones eliminadas: ${transaccionesResult.deletedCount}`);

            // 3. Eliminar subcuentas
            const subcuentasResult = await this.subcuentaModel.deleteMany({ userId });
            formatSummary.subcuentas = subcuentasResult.deletedCount;
            this.logger.log(`Subcuentas eliminadas: ${subcuentasResult.deletedCount}`);

            // 4. Eliminar historial de subcuentas (si existe el modelo)
            try {
                const SubcuentaHistorial = this.subcuentaModel.db.model('SubcuentaHistorial');
                const historialSubcuentasResult = await SubcuentaHistorial.deleteMany({ userId });
                formatSummary.historialSubcuentas = historialSubcuentasResult.deletedCount;
                this.logger.log(`Historial de subcuentas eliminado: ${historialSubcuentasResult.deletedCount}`);
            } catch (error) {
                this.logger.warn('No se pudo eliminar historial de subcuentas (modelo no encontrado)');
            }

            // 5. Eliminar recurrentes (si existe el modelo)
            try {
                const Recurrente = this.userModel.db.model('Recurrente');
                const recurrentesResult = await Recurrente.deleteMany({ userId });
                formatSummary.recurrentes = recurrentesResult.deletedCount;
                this.logger.log(`Recurrentes eliminados: ${recurrentesResult.deletedCount}`);
            } catch (error) {
                this.logger.warn('No se pudo eliminar recurrentes (modelo no encontrado)');
            }

            // 6. Eliminar notificaciones (si existe el modelo)
            try {
                const Notificacion = this.userModel.db.model('Notificacion');
                const notificacionesResult = await Notificacion.deleteMany({ userId });
                formatSummary.notificaciones = notificacionesResult.deletedCount;
                this.logger.log(`Notificaciones eliminadas: ${notificacionesResult.deletedCount}`);
            } catch (error) {
                this.logger.warn('No se pudo eliminar notificaciones (modelo no encontrado)');
            }

            // 7. Eliminar goals (si existe el modelo)
            try {
                const Goal = this.userModel.db.model('Goal');
                const goalsResult = await Goal.deleteMany({ userId });
                formatSummary.goals = goalsResult.deletedCount;
                this.logger.log(`Goals eliminados: ${goalsResult.deletedCount}`);
            } catch (error) {
                this.logger.warn('No se pudo eliminar goals (modelo no encontrado)');
            }

            // 8. Resetear cuenta principal a cero (NO eliminar)
            await this.cuentaModel.updateOne(
                { userId, isPrincipal: true },
                { 
                    $set: { 
                        cantidad: 0,
                    }
                }
            );
            this.logger.log(`Cuenta principal reseteada a cero`);

            // 9. NO eliminar el usuario - mantenerlo intacto
            this.logger.log(`Usuario ${userId} mantenido, cuenta formateada exitosamente`);

            return {
                message: `Cuenta del usuario ${userId} ha sido formateada exitosamente. El usuario y su cuenta principal se mantienen intactos.`,
                summary: formatSummary,
                timestamp: new Date().toISOString(),
                note: 'El usuario puede continuar usando su cuenta normalmente desde cero.'
            };

        } catch (error) {
            this.logger.error(`Error durante el formateo de la cuenta del usuario ${userId}:`, error);
            throw new Error(`Error al formatear la cuenta: ${error.message}`);
        }
    }
}