import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subcuenta, SubcuentaDocument } from '../../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { Recurrente, RecurrenteDocument } from '../../recurrentes/schemas/recurrente.schema';

@Injectable()
export class PlanAutoPauseService {
  private readonly logger = new Logger(PlanAutoPauseService.name);

  constructor(
    @InjectModel(Subcuenta.name) private subcuentaModel: Model<SubcuentaDocument>,
    @InjectModel(Recurrente.name) private recurrenteModel: Model<RecurrenteDocument>,
  ) {}

  /**
   * Pausa automáticamente subcuentas y recurrentes cuando el usuario pierde premium
   */
  async pauseOnPremiumExpiry(userId: string): Promise<{
    subcuentasPausadas: number;
    recurrentesPausados: number;
  }> {
    this.logger.log(`[PlanAutoPause] Pausando recursos para usuario ${userId} (premium expiró)`);

    // Pausar subcuentas activas (marcar pausadaPorPlan y desactivar)
    const subcuentasResult = await this.subcuentaModel.updateMany(
      { 
        userId, 
        activa: true,
        pausadaPorPlan: { $ne: true } // Solo las que no están ya pausadas por plan
      },
      { 
        $set: { 
          activa: false, 
          pausadaPorPlan: true 
        } 
      }
    );

    // Pausar recurrentes activos (marcar pausadoPorPlan y pausado=true)
    const recurrentesResult = await this.recurrenteModel.updateMany(
      { 
        userId, 
        pausado: false,
        estado: { $ne: 'completado' }, // No pausar los ya completados
        pausadoPorPlan: { $ne: true }
      },
      { 
        $set: { 
          pausado: true, 
          estado: 'pausado',
          pausadoPorPlan: true 
        } 
      }
    );

    const subcuentasPausadas = subcuentasResult.modifiedCount;
    const recurrentesPausados = recurrentesResult.modifiedCount;

    this.logger.log(
      `[PlanAutoPause] Usuario ${userId}: ${subcuentasPausadas} subcuentas y ${recurrentesPausados} recurrentes pausados`
    );

    return { subcuentasPausadas, recurrentesPausados };
  }

  /**
   * Reanuda automáticamente subcuentas y recurrentes cuando el usuario recupera premium
   */
  async resumeOnPremiumReactivation(userId: string): Promise<{
    subcuentasReanudadas: number;
    recurrentesReanudados: number;
  }> {
    this.logger.log(`[PlanAutoPause] Reanudando recursos para usuario ${userId} (premium reactivado)`);

    // Reanudar solo las subcuentas que fueron pausadas automáticamente por el plan
    const subcuentasResult = await this.subcuentaModel.updateMany(
      { 
        userId, 
        pausadaPorPlan: true 
      },
      { 
        $set: { 
          activa: true, 
          pausadaPorPlan: false 
        } 
      }
    );

    // Reanudar solo los recurrentes que fueron pausados automáticamente por el plan
    const recurrentesResult = await this.recurrenteModel.updateMany(
      { 
        userId, 
        pausadoPorPlan: true 
      },
      { 
        $set: { 
          pausado: false, 
          estado: 'activo',
          pausadoPorPlan: false 
        } 
      }
    );

    const subcuentasReanudadas = subcuentasResult.modifiedCount;
    const recurrentesReanudados = recurrentesResult.modifiedCount;

    this.logger.log(
      `[PlanAutoPause] Usuario ${userId}: ${subcuentasReanudadas} subcuentas y ${recurrentesReanudados} recurrentes reanudados`
    );

    return { subcuentasReanudadas, recurrentesReanudados };
  }

  /**
   * Verifica y ejecuta pausas/reanudaciones según el cambio de estado de premium
   */
  async handlePlanTransition(
    userId: string, 
    wasPremium: boolean, 
    isPremiumNow: boolean
  ): Promise<{ subcuentas?: number; recurrentes?: number }> {
    // Perdió premium
    if (wasPremium && !isPremiumNow) {
      const result = await this.pauseOnPremiumExpiry(userId);
      return { subcuentas: result.subcuentasPausadas, recurrentes: result.recurrentesPausados };
    }
    
    // Recuperó premium
    if (!wasPremium && isPremiumNow) {
      const result = await this.resumeOnPremiumReactivation(userId);
      return { subcuentas: result.subcuentasReanudadas, recurrentes: result.recurrentesReanudados };
    }

    return {};
  }
}
