import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PlanConfig, PlanConfigDocument } from './schemas/plan-config.schema';
import { CreatePlanConfigDto, UpdatePlanConfigDto } from './dto/plan-config.dto';

@Injectable()
export class PlanConfigService {
  private readonly logger = new Logger(PlanConfigService.name);

  constructor(
    @InjectModel(PlanConfig.name)
    private planConfigModel: Model<PlanConfigDocument>,
  ) {}

  async create(createDto: CreatePlanConfigDto): Promise<PlanConfig> {
    this.logger.log(`Creando configuración de plan: ${createDto.planType}`);
    const config = new this.planConfigModel(createDto);
    return config.save();
  }

  async findAll(): Promise<PlanConfig[]> {
    return this.planConfigModel.find().exec();
  }

  async findByPlanType(planType: string): Promise<PlanConfig | null> {
    return this.planConfigModel.findOne({ planType }).exec();
  }

  async update(planType: string, updateDto: UpdatePlanConfigDto): Promise<PlanConfig> {
    this.logger.log(`Actualizando configuración de plan: ${planType}`);
    const config = await this.planConfigModel.findOneAndUpdate(
      { planType },
      { $set: updateDto },
      { new: true },
    ).exec();

    if (!config) {
      throw new NotFoundException(`Configuración de plan ${planType} no encontrada`);
    }

    return config;
  }

  async delete(planType: string): Promise<void> {
    this.logger.log(`Eliminando configuración de plan: ${planType}`);
    const result = await this.planConfigModel.deleteOne({ planType }).exec();
    
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Configuración de plan ${planType} no encontrada`);
    }
  }

  async initializeDefaults(): Promise<void> {
    const freePlan = await this.findByPlanType('free_plan');
    if (!freePlan) {
      this.logger.log('Inicializando configuración de plan gratuito por defecto');
      await this.create({
        planType: 'free_plan',
        transaccionesPorDia: 10,
        historicoLimitadoDias: 30,
        recurrentesPorUsuario: 3,
        subcuentasPorUsuario: 2,
        graficasAvanzadas: false,
        activo: true,
      });
    }

    const premiumPlan = await this.findByPlanType('premium_plan');
    if (!premiumPlan) {
      this.logger.log('Inicializando configuración de plan premium por defecto');
      await this.create({
        planType: 'premium_plan',
        transaccionesPorDia: -1, // -1 significa ilimitado
        historicoLimitadoDias: -1, // -1 significa ilimitado
        recurrentesPorUsuario: -1, // -1 significa ilimitado
        subcuentasPorUsuario: -1, // -1 significa ilimitado
        graficasAvanzadas: true,
        activo: true,
      });
    }
  }

  async canPerformAction(
    userId: string,
    planType: string,
    actionType: 'transaction' | 'recurrente' | 'subcuenta' | 'grafica',
    currentCount?: number,
  ): Promise<{ allowed: boolean; message?: string }> {
    const config = await this.findByPlanType(planType);
    
    if (!config || !config.activo) {
      return { allowed: false, message: 'Configuración de plan no disponible' };
    }

    switch (actionType) {
      case 'transaction':
        // Para transacciones, se debería verificar el conteo diario en otra parte
        // Aquí solo validamos que el límite existe
        if (config.transaccionesPorDia === -1) {
          return { allowed: true };
        }
        return { 
          allowed: true, 
          message: `Límite: ${config.transaccionesPorDia} transacciones por día` 
        };

      case 'recurrente':
        if (config.recurrentesPorUsuario === -1) {
          return { allowed: true };
        }
        if (currentCount !== undefined && currentCount >= config.recurrentesPorUsuario) {
          return { 
            allowed: false, 
            message: `Has alcanzado el límite de ${config.recurrentesPorUsuario} recurrentes` 
          };
        }
        return { allowed: true };

      case 'subcuenta':
        if (config.subcuentasPorUsuario === -1) {
          return { allowed: true };
        }
        if (currentCount !== undefined && currentCount >= config.subcuentasPorUsuario) {
          return { 
            allowed: false, 
            message: `Has alcanzado el límite de ${config.subcuentasPorUsuario} subcuentas` 
          };
        }
        return { allowed: true };

      case 'grafica':
        if (!config.graficasAvanzadas) {
          return { 
            allowed: false, 
            message: 'Las gráficas avanzadas están disponibles solo para usuarios premium' 
          };
        }
        return { allowed: true };

      default:
        return { allowed: false, message: 'Tipo de acción no reconocida' };
    }
  }
}
