import { 
  Controller, 
  Get, 
  Query, 
  Req, 
  UseGuards, 
  ValidationPipe,
  UsePipes,
  Logger
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';
import { AnalyticsFiltersDto, MovimientosFiltersDto } from './dto/analytics-filters.dto';
import {
  ResumenFinanciero,
  EstadisticasPorConcepto,
  EstadisticasPorSubcuenta,
  EstadisticasPorRecurrente,
  AnalisisTemporal,
  MovimientosResponse,
  ComparacionPeriodos
} from './interfaces/analytics.interfaces';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /analytics/resumen-financiero
   * Obtiene resumen completo: total ingresado, total gastado, balance, total en subcuentas
   */
  @Get('resumen-financiero')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async obtenerResumenFinanciero(
    @Req() req: any,
    @Query() filtros: AnalyticsFiltersDto
  ): Promise<ResumenFinanciero> {
    const userId = req.user.sub;
    this.logger.log(`Obteniendo resumen financiero para usuario: ${userId}`);
    
    return this.analyticsService.obtenerResumenFinanciero(userId, filtros);
  }

  /**
   * GET /analytics/por-concepto
   * Estadísticas agrupadas por concepto/categoría
   */
  @Get('por-concepto')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async obtenerEstadisticasPorConcepto(
    @Req() req: any,
    @Query() filtros: AnalyticsFiltersDto
  ): Promise<EstadisticasPorConcepto[]> {
    const userId = req.user.sub;
    this.logger.log(`Obteniendo estadísticas por concepto para usuario: ${userId}`);
    
    return this.analyticsService.obtenerEstadisticasPorConcepto(userId, filtros);
  }

  /**
   * GET /analytics/por-subcuenta
   * Estadísticas agrupadas por subcuenta/ahorros
   */
  @Get('por-subcuenta')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async obtenerEstadisticasPorSubcuenta(
    @Req() req: any,
    @Query() filtros: AnalyticsFiltersDto
  ): Promise<EstadisticasPorSubcuenta[]> {
    const userId = req.user.sub;
    this.logger.log(`Obteniendo estadísticas por subcuenta para usuario: ${userId}`);
    
    return this.analyticsService.obtenerEstadisticasPorSubcuenta(userId, filtros);
  }

  /**
   * GET /analytics/por-recurrente
   * Estadísticas de pagos recurrentes
   */
  @Get('por-recurrente')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async obtenerEstadisticasPorRecurrente(
    @Req() req: any,
    @Query() filtros: AnalyticsFiltersDto
  ): Promise<EstadisticasPorRecurrente[]> {
    const userId = req.user.sub;
    this.logger.log(`Obteniendo estadísticas por recurrente para usuario: ${userId}`);
    
    return this.analyticsService.obtenerEstadisticasPorRecurrente(userId, filtros);
  }

  /**
   * GET /analytics/analisis-temporal
   * Análisis de tendencias temporales (ingresos/gastos por día/semana/mes)
   */
  @Get('analisis-temporal')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async obtenerAnalisisTemporal(
    @Req() req: any,
    @Query() filtros: AnalyticsFiltersDto
  ): Promise<AnalisisTemporal> {
    const userId = req.user.sub;
    this.logger.log(`Obteniendo análisis temporal para usuario: ${userId}`);
    
    return this.analyticsService.obtenerAnalisisTemporal(userId, filtros);
  }

  /**
   * GET /analytics/movimientos-detallados
   * Lista completa de movimientos con filtros avanzados y paginación
   */
  @Get('movimientos-detallados')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async obtenerMovimientosDetallados(
    @Req() req: any,
    @Query() filtros: MovimientosFiltersDto
  ): Promise<MovimientosResponse> {
    const userId = req.user.sub;
    this.logger.log(`Obteniendo movimientos detallados para usuario: ${userId}`);
    
    return this.analyticsService.obtenerMovimientosDetallados(userId, filtros);
  }

  /**
   * GET /analytics/comparacion-periodos
   * Compara estadísticas entre período actual vs período anterior
   */
  @Get('comparacion-periodos')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async compararPeriodos(
    @Req() req: any,
    @Query() filtros: AnalyticsFiltersDto
  ): Promise<ComparacionPeriodos> {
    const userId = req.user.sub;
    this.logger.log(`Comparando períodos para usuario: ${userId}`);
    
    return this.analyticsService.compararPeriodos(userId, filtros);
  }

  /**
   * GET /analytics/totales-rapidos
   * Endpoint rápido para obtener solo los totales básicos (sin desglose)
   */
  @Get('totales-rapidos')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async obtenerTotalesRapidos(
    @Req() req: any,
    @Query() filtros: AnalyticsFiltersDto
  ): Promise<{
    totalIngresado: number;
    totalGastado: number;
    balance: number;
    totalSubcuentas: number;
    totalMovimientos: number;
    moneda: string;
  }> {
    const userId = req.user.sub;
    this.logger.log(`Obteniendo totales rápidos para usuario: ${userId}`);
    
    const resumen = await this.analyticsService.obtenerResumenFinanciero(userId, filtros);
    
    return {
      totalIngresado: resumen.totalIngresado.monto,
      totalGastado: resumen.totalGastado.monto,
      balance: resumen.balance.monto,
      totalSubcuentas: resumen.totalEnSubcuentas.monto,
      totalMovimientos: resumen.totalMovimientos,
      moneda: resumen.totalIngresado.moneda
    };
  }

  /**
   * GET /analytics/top-gastos
   * Top de conceptos con más gastos
   */
  @Get('top-gastos')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async obtenerTopGastos(
    @Req() req: any,
    @Query() filtros: AnalyticsFiltersDto,
    @Query('limite') limite: number = 10
  ): Promise<{
    concepto: string;
    nombre: string;
    monto: number;
    cantidadMovimientos: number;
    color?: string;
  }[]> {
    const userId = req.user.sub;
    this.logger.log(`Obteniendo top gastos para usuario: ${userId}`);
    
    const estadisticas = await this.analyticsService.obtenerEstadisticasPorConcepto(userId, filtros);
    
    return estadisticas
      .filter(stat => stat.totalGasto > 0)
      .sort((a, b) => b.totalGasto - a.totalGasto)
      .slice(0, limite)
      .map(stat => ({
        concepto: stat.concepto.id,
        nombre: stat.concepto.nombre,
        monto: stat.totalGasto,
        cantidadMovimientos: stat.cantidadMovimientos,
        color: stat.concepto.color
      }));
  }

  /**
   * GET /analytics/subcuentas-activas
   * Resumen de subcuentas activas con sus saldos
   */
  @Get('subcuentas-activas')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async obtenerSubcuentasActivas(
    @Req() req: any,
    @Query() filtros: AnalyticsFiltersDto
  ): Promise<{
    id: string;
    nombre: string;
    saldo: number;
    moneda: string;
    simbolo: string;
    ultimoMovimiento?: Date;
    crecimiento: number;
  }[]> {
    const userId = req.user.sub;
    this.logger.log(`Obteniendo subcuentas activas para usuario: ${userId}`);
    
    // Forzar incluir solo subcuentas activas
    const filtrosActivas = { ...filtros, incluirSubcuentasInactivas: false };
    const estadisticas = await this.analyticsService.obtenerEstadisticasPorSubcuenta(userId, filtrosActivas);
    
    return estadisticas.map(stat => ({
      id: stat.subcuenta.id,
      nombre: stat.subcuenta.nombre,
      saldo: stat.saldoActual,
      moneda: stat.subcuenta.moneda,
      simbolo: stat.subcuenta.simbolo,
      ultimoMovimiento: stat.ultimoMovimiento,
      crecimiento: stat.crecimientoMensual
    }));
  }

  /**
   * GET /analytics/metricas-mes-actual
   * Métricas específicas del mes actual vs mes anterior
   */
  @Get('metricas-mes-actual')
  async obtenerMetricasMesActual(@Req() req: any): Promise<{
    mesActual: {
      ingresos: number;
      gastos: number;
      balance: number;
      movimientos: number;
    };
    mesAnterior: {
      ingresos: number;
      gastos: number;
      balance: number;
      movimientos: number;
    };
    cambios: {
      ingresos: { absoluto: number; porcentual: number };
      gastos: { absoluto: number; porcentual: number };
      balance: { absoluto: number; porcentual: number };
      movimientos: { absoluto: number; porcentual: number };
    };
  }> {
    const userId = req.user.sub;
    this.logger.log(`Obteniendo métricas del mes actual para usuario: ${userId}`);
    
    const filtrosMesActual: AnalyticsFiltersDto = {
      rangoTiempo: 'mes'
    };
    
    const comparacion = await this.analyticsService.compararPeriodos(userId, filtrosMesActual);
    
    return {
      mesActual: {
        ingresos: comparacion.periodoActual.ingresos,
        gastos: comparacion.periodoActual.gastos,
        balance: comparacion.periodoActual.balance,
        movimientos: comparacion.periodoActual.movimientos
      },
      mesAnterior: {
        ingresos: comparacion.periodoAnterior.ingresos,
        gastos: comparacion.periodoAnterior.gastos,
        balance: comparacion.periodoAnterior.balance,
        movimientos: comparacion.periodoAnterior.movimientos
      },
      cambios: comparacion.cambios
    };
  }
}
