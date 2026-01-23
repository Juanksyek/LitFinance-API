import { Controller, Post, Get, Body, Req, UseGuards, Query, Param, Patch, Delete, Logger, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubcuentaService } from './subcuenta.service';
import { CreateSubcuentaDto } from './dto/create-subcuenta.dto/create-subcuenta.dto';
import { UpdateSubcuentaDto } from './dto/update-subcuenta.dto/update-subcuenta.dto';
import { PlanConfigService } from '../plan-config/plan-config.service';

@UseGuards(JwtAuthGuard)
@Controller('subcuenta')
export class SubcuentaController {
  private readonly logger = new Logger(SubcuentaController.name);

  constructor(
    private readonly subcuentaService: SubcuentaService,
    private readonly planConfigService: PlanConfigService,
  ) {}

  @Post()
  async crear(@Req() req, @Body() dto: CreateSubcuentaDto) {
    const userId = req.user.id;
    const userPlanType = req.user.planType ?? (req.user.isPremium ? 'premium_plan' : 'free_plan');

    // Obtener el número actual de subcuentas del usuario
    const subcuentasActuales = await this.subcuentaService.contarSubcuentas(userId);

    // Validar con el plan general (no personalizado)
    const validation = await this.planConfigService.canPerformAction(
      userId,
      userPlanType,
      'subcuenta',
      subcuentasActuales,
    );

    this.logger.log(`[Subcuenta] userId: ${userId} allowed: ${validation.allowed} message: ${validation.message}`);

    if (!validation.allowed) {
      throw new ForbiddenException(validation.message || 'No puedes crear más subcuentas con tu plan actual');
    }

    return this.subcuentaService.crear(dto, userId);
  }

  @Get(':userId')
  async listarPorUserId(
    @Param('userId') userId: string,
    @Query('subCuentaId') subCuentaId?: string,
    @Query('search') search?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 4,
    @Query('soloActivas') soloActivas?: string,
  ) {
    const incluirInactivas = soloActivas === 'true' ? false : true;
  
    return this.subcuentaService.listar(
      userId,
      subCuentaId,
      search,
      +page,
      +limit,
      incluirInactivas,
    );
  }

  @Get('buscar/:subCuentaId')
  async buscarPorSubCuentaId(@Param('subCuentaId') subCuentaId: string) {
    return this.subcuentaService.buscarPorSubCuentaId(subCuentaId);
  }

  @Patch(':id')
  async actualizar(@Req() req, @Param('id') id: string, @Body() dto: UpdateSubcuentaDto) {
    return this.subcuentaService.actualizar(id, dto);
  }

  @Delete(':id')
  async eliminar(@Req() req, @Param('id') id: string) {
    return this.subcuentaService.eliminar(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/historial')
  async obtenerHistorial(@Param('id') id: string, @Req() req) {
    return this.subcuentaService.obtenerHistorial(id, req.user.id);
  }

  // Movimientos financieros de una subcuenta (transacciones + recurrentes ejecutados)
  @Get(':id/movimientos')
  async obtenerMovimientos(
    @Param('id') id: string,
    @Req() req,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('search') search?: string,
  ) {
    return this.subcuentaService.obtenerMovimientosFinancieros(id, req.user.id, {
      page: Number(page),
      limit: Number(limit),
      desde,
      hasta,
      search,
    });
  }

  @Get('historial')
  async historialGeneral(@Req() req) {
    return this.subcuentaService.obtenerHistorial(null, req.user.id);
  }

  @Patch(':id/activar')
  async activar(@Param('id') id: string, @Req() req) {
    return this.subcuentaService.activar(id, req.user.id);
  }

  @Patch(':id/desactivar')
  async desactivar(@Req() req, @Param('id') id: string) {
    return this.subcuentaService.desactivar(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('participacion/:cuentaId')
  async calcularParticipacion(@Param('cuentaId') cuentaId: string, @Req() req) {
    return this.subcuentaService.calcularParticipacion(req.user.id);
  }
}
