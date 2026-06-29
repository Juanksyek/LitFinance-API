import { Controller, Post, Get, Body, Req, UseGuards, Query, Param, Patch, Delete, Logger, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubcuentaService } from './subcuenta.service';
import { CreateSubcuentaDto } from './dto/create-subcuenta.dto/create-subcuenta.dto';
import { UpdateSubcuentaDto } from './dto/update-subcuenta.dto/update-subcuenta.dto';
import { DeleteSubcuentaDto } from './dto/delete-subcuenta.dto/delete-subcuenta.dto';
import { PlanConfigService } from '../plan-config/plan-config.service';
import { SubcuentaHistoryQueryDto } from './dto/subcuenta-history-query.dto';
import { SubcuentaListQueryDto } from './dto/subcuenta-list-query.dto';
import { SearchProtectionService } from '../common/services/search-protection.service';

@UseGuards(JwtAuthGuard)
@Controller('subcuenta')
export class SubcuentaController {
  private readonly logger = new Logger(SubcuentaController.name);

  constructor(
    private readonly subcuentaService: SubcuentaService,
    private readonly planConfigService: PlanConfigService,
    private readonly searchProtectionService: SearchProtectionService,
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

  @Get()
  async listar(
    @Req() req,
    @Query() query: SubcuentaListQueryDto,
  ) {
    await this.searchProtectionService.guard({
      search: query.search,
      tracker: String(req.user?.id ?? req.ip ?? 'anonymous'),
      scope: 'subcuenta',
    });

    const userId = req.user.id;
    const incluirInactivas = query.soloActivas === 'true' ? false : true;
  
    return this.subcuentaService.listar(
      userId,
      query.subCuentaId,
      query.search,
      Number(query.page ?? 1),
      Number(query.limit ?? 4),
      incluirInactivas,
    );
  }

  @Get(':userId')
  async listarPorUserId(
    @Req() req,
    @Param('userId') _userId: string,
    @Query() query: SubcuentaListQueryDto,
  ) {
    await this.searchProtectionService.guard({
      search: query.search,
      tracker: String(req.user?.id ?? req.ip ?? 'anonymous'),
      scope: 'subcuenta',
    });

    const userId = req.user.id;
    const incluirInactivas = query.soloActivas === 'true' ? false : true;
  
    return this.subcuentaService.listar(
      userId,
      query.subCuentaId,
      query.search,
      Number(query.page ?? 1),
      Number(query.limit ?? 4),
      incluirInactivas,
    );
  }

  @Get('buscar/:subCuentaId')
  async buscarPorSubCuentaId(@Req() req, @Param('subCuentaId') subCuentaId: string) {
    return this.subcuentaService.buscarPorSubCuentaId(subCuentaId, req.user.id);
  }

  @Patch(':id')
  async actualizar(@Req() req, @Param('id') id: string, @Body() dto: UpdateSubcuentaDto) {
    return this.subcuentaService.actualizar(id, dto);
  }

  @Delete(':id')
  async eliminar(@Req() req, @Param('id') id: string) {
    return this.subcuentaService.eliminar(id, req.user.id);
  }

  @Post(':id/eliminar')
  async eliminarConDecision(@Req() req, @Param('id') id: string, @Body() dto: DeleteSubcuentaDto) {
    return this.subcuentaService.eliminarConDecision(id, req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/historial')
  async obtenerHistorial(
    @Param('id') id: string,
    @Req() req,
    @Query() query: SubcuentaHistoryQueryDto,
  ) {
    await this.searchProtectionService.guard({
      search: query.search,
      tracker: String(req.user?.id ?? req.ip ?? 'anonymous'),
      scope: 'subcuenta-history',
    });

    return this.subcuentaService.obtenerHistorial(
      id,
      req.user.id,
      undefined,
      query.desde,
      query.hasta,
      Number(query.page ?? 1),
      Number(query.limit ?? 20),
      query.search ?? '',
    );
  }

  // Movimientos financieros de una subcuenta (transacciones + recurrentes ejecutados)
  @Get(':id/movimientos')
  async obtenerMovimientos(
    @Param('id') id: string,
    @Req() req,
    @Query() query: SubcuentaHistoryQueryDto,
  ) {
    await this.searchProtectionService.guard({
      search: query.search,
      tracker: String(req.user?.id ?? req.ip ?? 'anonymous'),
      scope: 'subcuenta-movimientos',
    });

    return this.subcuentaService.obtenerMovimientosFinancieros(id, req.user.id, {
      page: Number(query.page ?? 1),
      limit: Number(query.limit ?? 20),
      desde: query.desde,
      hasta: query.hasta,
      search: query.search,
    });
  }

  @Get('historial')
  async historialGeneral(@Req() req, @Query() query: SubcuentaHistoryQueryDto) {
    await this.searchProtectionService.guard({
      search: query.search,
      tracker: String(req.user?.id ?? req.ip ?? 'anonymous'),
      scope: 'subcuenta-history',
    });

    return this.subcuentaService.obtenerHistorial(
      null,
      req.user.id,
      undefined,
      query.desde,
      query.hasta,
      Number(query.page ?? 1),
      Number(query.limit ?? 20),
      query.search ?? '',
    );
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
