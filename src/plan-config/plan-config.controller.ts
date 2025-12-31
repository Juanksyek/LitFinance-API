import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlanConfigService } from './plan-config.service';
import { CreatePlanConfigDto, UpdatePlanConfigDto } from './dto/plan-config.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('plan-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlanConfigController {
  private readonly logger = new Logger(PlanConfigController.name);

  constructor(private readonly planConfigService: PlanConfigService) {}


  @Post()
  @Roles('admin')
  async create(@Body() createDto: CreatePlanConfigDto) {
    this.logger.log(`POST /plan-config - Crear configuración: ${createDto.planType}`);
    return this.planConfigService.create(createDto);
  }


  @Get()
  @Roles('admin')
  async findAll() {
    this.logger.log('GET /plan-config - Obtener todas las configuraciones');
    return this.planConfigService.findAll();
  }


  @Get(':planType')
  @Roles('admin')
    async findOne(@Param('planType') planType: string) {
      this.logger.log(`GET /plan-config/${planType} - Obtener configuración`);
      const config = await this.planConfigService.findByPlanType(planType);
      if (!config) {
        throw new (await import('@nestjs/common')).NotFoundException(`Configuración de plan ${planType} no encontrada`);
      }
      return config;
    }


  @Put(':planType')
  @Roles('admin')
  async update(
    @Param('planType') planType: string,
    @Body() updateDto: UpdatePlanConfigDto,
  ) {
    this.logger.log(`PUT /plan-config/${planType} - Actualizar configuración`);
    return this.planConfigService.update(planType, updateDto);
  }


  @Delete(':planType')
  @Roles('admin')
  async delete(@Param('planType') planType: string) {
    this.logger.log(`DELETE /plan-config/${planType} - Eliminar configuración`);
    await this.planConfigService.delete(planType);
    return { message: `Configuración ${planType} eliminada correctamente` };
  }


  @Post('initialize-defaults')
  @Roles('admin')
  async initializeDefaults() {
    this.logger.log('POST /plan-config/initialize-defaults');
    await this.planConfigService.initializeDefaults();
    return { message: 'Configuraciones por defecto inicializadas' };
  }

  @Get(':planType/can-perform/:action')
  async canPerformAction(
    @Param('planType') planType: string,
    @Param('action') action: 'transaction' | 'recurrente' | 'subcuenta' | 'grafica',
    @Query('currentCount') currentCount?: string,
  ) {
    this.logger.log(`GET /plan-config/${planType}/can-perform/${action}`);
    const parsedCurrentCount = currentCount !== undefined ? Number(currentCount) : undefined;
    return this.planConfigService.canPerformAction(
      '',
      planType,
      action,
      Number.isFinite(parsedCurrentCount) ? parsedCurrentCount : undefined,
    );
  }
}
