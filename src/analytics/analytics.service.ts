import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { Cuenta, CuentaDocument } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaDocument } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { Transaction, TransactionDocument } from '../transactions/schemas/transaction.schema/transaction.schema';
import { CuentaHistorial, CuentaHistorialDocument } from '../cuenta-historial/schemas/cuenta-historial.schema';
import { ConceptoPersonalizado, ConceptoPersonalizadoDocument } from '../conceptos/schemas/concepto-personalizado.schema';
import { MonedaService } from '../moneda/moneda.service';
import { MoneyValidationService } from '../utils/validators/money-validation.service';
import { CurrencyConversionService } from '../user/services/currency-conversion.service';
import { AnalyticsFiltersDto, MovimientosFiltersDto } from './dto/analytics-filters.dto';
import {
  ResumenFinanciero,
  EstadisticasPorConcepto,
  EstadisticasPorSubcuenta,
  EstadisticasPorRecurrente,
  AnalisisTemporal,
  AnalisisTemporalData,
  MovimientosResponse,
  MovimientoDetallado,
  ComparacionPeriodos
} from './interfaces/analytics.interfaces';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
    @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<SubcuentaDocument>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(CuentaHistorial.name) private readonly historialModel: Model<CuentaHistorialDocument>,
    @InjectModel(ConceptoPersonalizado.name) private readonly conceptoModel: Model<ConceptoPersonalizadoDocument>,
    private readonly monedaService: MonedaService,
    private readonly moneyValidationService: MoneyValidationService,
    private readonly currencyConversionService: CurrencyConversionService,
  ) {}

  /**
   * Obtiene un resumen financiero completo del usuario
   */
  async obtenerResumenFinanciero(userId: string, filtros: AnalyticsFiltersDto): Promise<ResumenFinanciero> {
    this.logger.log(`Generando resumen financiero para usuario: ${userId}`);

    // Validar filtros de montos si están presentes
    if (filtros.montoMinimo !== undefined || filtros.montoMaximo !== undefined) {
      this.validarFiltrosMontos(filtros);
    }

    // Verificar que el usuario existe
    const usuario = await this.userModel.findOne({ id: userId });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const { fechaInicio, fechaFin } = this.calcularRangoFechas(filtros);
    const monedaBase = filtros.monedaBase || usuario.monedaPreferencia || 'USD';

    // Obtener transacciones filtradas
    const query = this.construirQueryTransacciones(userId, filtros, fechaInicio, fechaFin);
    const transacciones = await this.transactionModel.find(query);

    // Validar si hay transacciones sospechosas
    if (transacciones.length > 0) {
      this.analizarTransaccionesSospechosas(transacciones, userId);
    }

    // Obtener historial de cuentas filtrado
    const queryHistorial = this.construirQueryHistorial(userId, filtros, fechaInicio, fechaFin);
    const historial = await this.historialModel.find(queryHistorial);

    // Procesar ingresos y gastos con validación
    const { totalIngresado, totalGastado } = await this.procesarIngresosGastos(
      transacciones, 
      historial, 
      monedaBase
    );

    // Obtener total en subcuentas
    const totalEnSubcuentas = await this.calcularTotalSubcuentas(userId, filtros, monedaBase);

    // Contar movimientos totales
    const totalMovimientos = transacciones.length + historial.length;

    const balance = totalIngresado.monto - totalGastado.monto;

    return {
      totalIngresado,
      totalGastado,
      balance: {
        monto: this.moneyValidationService.sanitizeAmount(balance),
        moneda: monedaBase,
        esPositivo: balance >= 0
      },
      totalEnSubcuentas,
      totalMovimientos,
      periodo: {
        fechaInicio,
        fechaFin,
        descripcion: this.obtenerDescripcionPeriodo(filtros)
      }
    };
  }

  /**
   * Obtiene estadísticas agrupadas por concepto
   */
  async obtenerEstadisticasPorConcepto(userId: string, filtros: AnalyticsFiltersDto): Promise<EstadisticasPorConcepto[]> {
    this.logger.log(`Generando estadísticas por concepto para usuario: ${userId}`);

    const { fechaInicio, fechaFin } = this.calcularRangoFechas(filtros);
    const monedaBase = filtros.monedaBase || 'USD';

    // Pipeline de agregación para obtener estadísticas por concepto
    const pipeline = [
      {
        $match: {
          userId,
          createdAt: { $gte: fechaInicio, $lte: fechaFin }
        }
      },
      {
        $group: {
          _id: '$concepto',
          totalIngreso: {
            $sum: {
              $cond: [{ $eq: ['$tipo', 'ingreso'] }, '$monto', 0]
            }
          },
          totalGasto: {
            $sum: {
              $cond: [{ $eq: ['$tipo', 'egreso'] }, '$monto', 0]
            }
          },
          cantidadMovimientos: { $sum: 1 },
          montoPromedio: { $avg: '$monto' },
          ultimoMovimiento: { $max: '$createdAt' }
        }
      },
      {
        $sort: { totalGasto: -1 as const, totalIngreso: -1 as const }
      }
    ];

    const resultados = await this.transactionModel.aggregate(pipeline);

    // Obtener información de conceptos personalizados
    const conceptosIds = resultados.map(r => r._id);
    const conceptos = await this.conceptoModel.find({ 
      conceptoId: { $in: conceptosIds },
      userId
    });

    const conceptosMap = new Map(conceptos.map(c => [c.conceptoId, c]));

    // Calcular total para porcentajes
    const totalGeneral = resultados.reduce((sum, r) => sum + r.totalGasto + r.totalIngreso, 0);

    return resultados.map(resultado => {
      const concepto = conceptosMap.get(resultado._id);
      const montoTotal = resultado.totalGasto + resultado.totalIngreso;
      
      return {
        concepto: {
          id: resultado._id,
          nombre: concepto?.nombre || resultado._id,
          color: concepto?.color,
          icono: concepto?.icono
        },
        totalIngreso: resultado.totalIngreso,
        totalGasto: resultado.totalGasto,
        cantidadMovimientos: resultado.cantidadMovimientos,
        montoPromedio: resultado.montoPromedio,
        ultimoMovimiento: resultado.ultimoMovimiento,
        participacionPorcentual: totalGeneral > 0 ? (montoTotal / totalGeneral) * 100 : 0
      };
    });
  }

  /**
   * Obtiene estadísticas agrupadas por subcuenta
   */
  async obtenerEstadisticasPorSubcuenta(userId: string, filtros: AnalyticsFiltersDto): Promise<EstadisticasPorSubcuenta[]> {
    this.logger.log(`Generando estadísticas por subcuenta para usuario: ${userId}`);

    const incluirInactivas = filtros.incluirSubcuentasInactivas || false;
    const querySubcuentas: any = { userId };
    
    if (!incluirInactivas) {
      querySubcuentas.activa = true;
    }

    const subcuentas = await this.subcuentaModel.find(querySubcuentas);

    const estadisticas = await Promise.all(
      subcuentas.map(async (subcuenta) => {
        const { fechaInicio, fechaFin } = this.calcularRangoFechas(filtros);
        
        // Obtener transacciones de la subcuenta
        const transacciones = await this.transactionModel.find({
          userId,
          subCuentaId: subcuenta.subCuentaId,
          createdAt: { $gte: fechaInicio, $lte: fechaFin }
        });

        const totalIngresos = transacciones
          .filter(t => t.tipo === 'ingreso')
          .reduce((sum, t) => sum + t.monto, 0);

        const totalEgresos = transacciones
          .filter(t => t.tipo === 'egreso')
          .reduce((sum, t) => sum + t.monto, 0);

        const ultimoMovimiento = transacciones.length > 0 
          ? new Date(Math.max(...transacciones.map(t => (t as any).createdAt ? new Date((t as any).createdAt).getTime() : Date.now())))
          : undefined;

        // Calcular crecimiento mensual (comparar con mes anterior)
        const crecimientoMensual = await this.calcularCrecimientoMensual(
          subcuenta.subCuentaId, 
          userId
        );

        return {
          subcuenta: {
            id: subcuenta.subCuentaId,
            nombre: subcuenta.nombre,
            color: subcuenta.color,
            moneda: subcuenta.moneda,
            simbolo: subcuenta.simbolo,
            activa: subcuenta.activa
          },
          saldoActual: subcuenta.cantidad,
          totalIngresos,
          totalEgresos,
          cantidadMovimientos: transacciones.length,
          ultimoMovimiento,
          crecimientoMensual
        };
      })
    );

    return estadisticas.sort((a, b) => b.saldoActual - a.saldoActual);
  }

  /**
   * Obtiene estadísticas de recurrentes
   */
  async obtenerEstadisticasPorRecurrente(userId: string, filtros: AnalyticsFiltersDto): Promise<EstadisticasPorRecurrente[]> {
    this.logger.log(`Generando estadísticas por recurrente para usuario: ${userId}`);

    try {
      // Obtener recurrentes usando el modelo dinámico
      const RecurrenteModel = this.userModel.db.model('Recurrente');
      const recurrentes = await RecurrenteModel.find({ userId });

      if (recurrentes.length === 0) {
        return [];
      }

      // Obtener historial de recurrentes
      const HistorialRecurrenteModel = this.userModel.db.model('HistorialRecurrente');
      const { fechaInicio, fechaFin } = this.calcularRangoFechas(filtros);

      const estadisticas = await Promise.all(
        recurrentes.map(async (recurrente) => {
          const historialEjecuciones = await HistorialRecurrenteModel.find({
            recurrenteId: recurrente.recurrenteId,
            fecha: { $gte: fechaInicio, $lte: fechaFin }
          });

          const totalEjecutado = historialEjecuciones.reduce((sum, h) => sum + h.monto, 0);
          const ultimaEjecucion = historialEjecuciones.length > 0
            ? new Date(Math.max(...historialEjecuciones.map(h => h.fecha.getTime())))
            : undefined;

          return {
            recurrente: {
              id: recurrente.recurrenteId,
              nombre: recurrente.nombre,
              plataforma: recurrente.plataforma,
              frecuencia: `${recurrente.frecuenciaTipo}: ${recurrente.frecuenciaValor}`
            },
            montoMensual: recurrente.monto,
            totalEjecutado,
            ultimaEjecucion,
            proximaEjecucion: recurrente.proximaEjecucion,
            estadoActual: recurrente.pausado ? 'pausado' : 'activo' as 'pausado' | 'activo',
            cantidadEjecuciones: historialEjecuciones.length
          };
        })
      );

      return estadisticas.sort((a, b) => b.montoMensual - a.montoMensual);
    } catch (error) {
      this.logger.warn('No se pudieron obtener estadísticas de recurrentes', error);
      return [];
    }
  }

  /**
   * Obtiene análisis temporal de ingresos y gastos
   */
  async obtenerAnalisisTemporal(userId: string, filtros: AnalyticsFiltersDto): Promise<AnalisisTemporal> {
    this.logger.log(`Generando análisis temporal para usuario: ${userId}`);

    const { fechaInicio, fechaFin } = this.calcularRangoFechas(filtros);
    const periodoAnalisis = this.determinarPeriodoAnalisis(fechaInicio, fechaFin);

    // Definir el formato de agrupación según el periodo
    let formatoFecha: string;
    let intervalo: number;

    switch (periodoAnalisis) {
      case 'diario':
        formatoFecha = '%Y-%m-%d';
        intervalo = 24 * 60 * 60 * 1000; // 1 día en ms
        break;
      case 'semanal':
        formatoFecha = '%Y-%U'; // Año-Semana
        intervalo = 7 * 24 * 60 * 60 * 1000; // 1 semana en ms
        break;
      case 'mensual':
        formatoFecha = '%Y-%m';
        intervalo = 30 * 24 * 60 * 60 * 1000; // 30 días en ms
        break;
    }

    // Pipeline de agregación para datos temporales
    const pipeline = [
      {
        $match: {
          userId,
          createdAt: { $gte: fechaInicio, $lte: fechaFin }
        }
      },
      {
        $group: {
          _id: {
            fecha: { $dateToString: { format: formatoFecha, date: '$createdAt' } },
            tipo: '$tipo'
          },
          monto: { $sum: '$monto' },
          cantidad: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.fecha',
          ingresos: {
            $sum: {
              $cond: [{ $eq: ['$_id.tipo', 'ingreso'] }, '$monto', 0]
            }
          },
          gastos: {
            $sum: {
              $cond: [{ $eq: ['$_id.tipo', 'egreso'] }, '$monto', 0]
            }
          },
          cantidadMovimientos: { $sum: '$cantidad' }
        }
      },
      {
        $sort: { '_id': 1 as const }
      }
    ];

    const resultados = await this.transactionModel.aggregate(pipeline);

    // Procesar datos y llenar períodos faltantes
    const datos = this.procesarDatosTemporal(resultados, fechaInicio, fechaFin, periodoAnalisis);

    // Calcular tendencias
    const tendencias = this.calcularTendencias(datos);

    // Calcular promedios
    const promedios = this.calcularPromedios(datos);

    return {
      periodoAnalisis,
      datos,
      tendencias,
      promedios
    };
  }

  /**
   * Obtiene movimientos detallados con filtros y paginación
   */
  async obtenerMovimientosDetallados(userId: string, filtros: MovimientosFiltersDto): Promise<MovimientosResponse> {
    this.logger.log(`Obteniendo movimientos detallados para usuario: ${userId}`);

    try {
      // Validar filtros de montos
      await this.validarFiltrosMontos(filtros);

      const { fechaInicio, fechaFin } = this.calcularRangoFechas(filtros);
      const pagina = filtros.pagina || 1;
      const limite = filtros.limite || 20;
      const skip = (pagina - 1) * limite;

      // Construir query para transacciones
      const queryTransacciones = this.construirQueryTransacciones(userId, filtros, fechaInicio, fechaFin);
      
      // Construir query para historial
      const queryHistorial = this.construirQueryHistorial(userId, filtros, fechaInicio, fechaFin);

      // Obtener transacciones y historial
      const [transacciones, historial] = await Promise.all([
        this.transactionModel.find(queryTransacciones),
        this.historialModel.find(queryHistorial)
      ]);

      // Convertir a formato unificado
      const movimientos = await this.unificarMovimientos(transacciones, historial);

      // Filtrar por búsqueda si se especifica
      let movimientosFiltrados = movimientos;
      if (filtros.busqueda) {
        const busqueda = filtros.busqueda.toLowerCase();
        movimientosFiltrados = movimientos.filter(m => 
          m.descripcion.toLowerCase().includes(busqueda) ||
          m.concepto?.nombre.toLowerCase().includes(busqueda) ||
          m.subcuenta?.nombre.toLowerCase().includes(busqueda)
        );
      }

      // Ordenar
      movimientosFiltrados = this.ordenarMovimientos(movimientosFiltrados, filtros);

      // Validar y sanitizar montos en los movimientos
      const movimientosSanitizados = movimientosFiltrados.map(movimiento => ({
        ...movimiento,
        monto: this.moneyValidationService.sanitizeAmount(movimiento.monto)
      }));

      // Analizar patrones sospechosos
      const montos = movimientosSanitizados.map(m => Math.abs(m.monto)).filter(monto => monto > 0);
      if (montos.length > 0) {
        await this.analizarTransaccionesSospechosas(montos, userId);
      }

      // Calcular totales
      const totalElementos = movimientosSanitizados.length;
      const totalPaginas = Math.ceil(totalElementos / limite);

      // Aplicar paginación
      const movimientosPaginados = movimientosSanitizados.slice(skip, skip + limite);

      // Calcular resumen de la página
      const resumenPagina = this.calcularResumenPagina(movimientosPaginados);

      return {
        movimientos: movimientosPaginados,
        paginacion: {
          paginaActual: pagina,
          totalPaginas,
          totalElementos,
          elementosPorPagina: limite
        },
        filtrosAplicados: filtros,
        resumenPagina
      };
    } catch (error) {
      this.logger.error('Error en obtenerMovimientosDetallados:', error);
      throw new Error(`Error al obtener movimientos detallados: ${error.message}`);
    }
  }

  /**
   * Compara estadísticas entre dos períodos
   */
  async compararPeriodos(userId: string, filtros: AnalyticsFiltersDto): Promise<ComparacionPeriodos> {
    this.logger.log(`Comparando períodos para usuario: ${userId}`);

    const { fechaInicio: inicioActual, fechaFin: finActual } = this.calcularRangoFechas(filtros);
    
    // Calcular período anterior con la misma duración
    const duracionMs = finActual.getTime() - inicioActual.getTime();
    const inicioAnterior = new Date(inicioActual.getTime() - duracionMs);
    const finAnterior = new Date(inicioActual.getTime());

    // Obtener datos del período actual
    const datosActuales = await this.obtenerDatosPeriodo(userId, inicioActual, finActual);
    
    // Obtener datos del período anterior
    const datosAnteriores = await this.obtenerDatosPeriodo(userId, inicioAnterior, finAnterior);

    // Calcular cambios
    const cambios = this.calcularCambiosPeriodos(datosActuales, datosAnteriores);

    return {
      periodoActual: {
        fechaInicio: inicioActual,
        fechaFin: finActual,
        ...datosActuales
      },
      periodoAnterior: {
        fechaInicio: inicioAnterior,
        fechaFin: finAnterior,
        ...datosAnteriores
      },
      cambios
    };
  }

  // MÉTODOS PRIVADOS DE APOYO

  /**
   * Valida los filtros de montos para evitar valores extremos
   */
  private validarFiltrosMontos(filtros: AnalyticsFiltersDto): void {
    if (filtros.montoMinimo !== undefined) {
      const validacionMin = this.moneyValidationService.validateAmount(filtros.montoMinimo, 'filter');
      if (!validacionMin.isValid) {
        throw new BadRequestException(`Monto mínimo inválido: ${validacionMin.error}`);
      }
      if (validacionMin.warning) {
        this.logger.warn(`Filtro de monto mínimo sospechoso: ${validacionMin.warning}`);
      }
    }

    if (filtros.montoMaximo !== undefined) {
      const validacionMax = this.moneyValidationService.validateAmount(filtros.montoMaximo, 'filter');
      if (!validacionMax.isValid) {
        throw new BadRequestException(`Monto máximo inválido: ${validacionMax.error}`);
      }
      if (validacionMax.warning) {
        this.logger.warn(`Filtro de monto máximo sospechoso: ${validacionMax.warning}`);
      }
    }

    // Validar que el mínimo no sea mayor que el máximo
    if (filtros.montoMinimo !== undefined && filtros.montoMaximo !== undefined) {
      if (filtros.montoMinimo > filtros.montoMaximo) {
        throw new BadRequestException('El monto mínimo no puede ser mayor que el monto máximo');
      }
    }
  }

  /**
   * Analiza transacciones para detectar patrones sospechosos
   */
  private analizarTransaccionesSospechosas(transacciones: any[], userId: string): void {
    const montos = transacciones.map(t => t.monto);
    const fechas = transacciones.map(t => new Date(t.createdAt || t.updatedAt || Date.now()));

    const analisis = this.moneyValidationService.detectSuspiciousPatterns(montos, fechas);

    if (analisis.hasSuspiciousPattern) {
      this.logger.warn(`Patrones sospechosos detectados para usuario ${userId}:`, {
        patterns: analisis.patterns,
        riskLevel: analisis.riskLevel,
        transactionCount: transacciones.length
      });

      // Si el riesgo es alto, se podría implementar alertas adicionales
      if (analisis.riskLevel === 'high') {
        this.logger.error(`ALERTA: Usuario ${userId} con actividad de alto riesgo detectada`);
        // Aquí se podría integrar con un sistema de alertas o notificaciones
      }
    }
  }

  private calcularRangoFechas(filtros: AnalyticsFiltersDto): { fechaInicio: Date; fechaFin: Date } {
    if (filtros.rangoTiempo === 'personalizado' && filtros.fechaInicio && filtros.fechaFin) {
      return {
        fechaInicio: new Date(filtros.fechaInicio),
        fechaFin: new Date(filtros.fechaFin)
      };
    }

    const ahora = new Date();
    let fechaInicio: Date;

    switch (filtros.rangoTiempo) {
      case 'dia':
        fechaInicio = new Date(ahora);
        fechaInicio.setHours(0, 0, 0, 0);
        break;
      case 'semana':
        fechaInicio = new Date(ahora);
        fechaInicio.setDate(ahora.getDate() - 7);
        break;
      case 'mes':
        fechaInicio = new Date(ahora);
        fechaInicio.setMonth(ahora.getMonth() - 1);
        break;
      case '3meses':
        fechaInicio = new Date(ahora);
        fechaInicio.setMonth(ahora.getMonth() - 3);
        break;
      case '6meses':
        fechaInicio = new Date(ahora);
        fechaInicio.setMonth(ahora.getMonth() - 6);
        break;
      case 'año':
        fechaInicio = new Date(ahora);
        fechaInicio.setFullYear(ahora.getFullYear() - 1);
        break;
      default:
        // Por defecto: último mes
        fechaInicio = new Date(ahora);
        fechaInicio.setMonth(ahora.getMonth() - 1);
        break;
    }

    return { fechaInicio, fechaFin: ahora };
  }

  private construirQueryTransacciones(userId: string, filtros: AnalyticsFiltersDto, fechaInicio: Date, fechaFin: Date): any {
    const query: any = {
      userId,
      createdAt: { $gte: fechaInicio, $lte: fechaFin }
    };

    if (filtros.subcuentas?.length) {
      query.subCuentaId = { $in: filtros.subcuentas };
    }

    if (filtros.conceptos?.length) {
      query.concepto = { $in: filtros.conceptos };
    }

    if (filtros.cuentas?.length) {
      query.cuentaId = { $in: filtros.cuentas };
    }

    if (filtros.tipoTransaccion && filtros.tipoTransaccion !== 'ambos') {
      query.tipo = filtros.tipoTransaccion;
    }

    if (filtros.montoMinimo !== undefined) {
      query.monto = { ...query.monto, $gte: filtros.montoMinimo };
    }

    if (filtros.montoMaximo !== undefined) {
      query.monto = { ...query.monto, $lte: filtros.montoMaximo };
    }

    if (filtros.soloTransaccionesManuales) {
      // Excluir transacciones generadas por recurrentes
      query.esRecurrente = { $ne: true };
    }

    return query;
  }

  private construirQueryHistorial(userId: string, filtros: AnalyticsFiltersDto, fechaInicio: Date, fechaFin: Date): any {
    const query: any = {
      userId,
      createdAt: { $gte: fechaInicio, $lte: fechaFin }
    };

    if (!filtros.incluirRecurrentes) {
      query.tipo = { $ne: 'recurrente' };
    }

    if (filtros.subcuentas?.length) {
      query.subcuentaId = { $in: filtros.subcuentas };
    }

    if (filtros.conceptos?.length) {
      query.conceptoId = { $in: filtros.conceptos };
    }

    if (filtros.cuentas?.length) {
      query.cuentaId = { $in: filtros.cuentas };
    }

    if (filtros.tipoTransaccion && filtros.tipoTransaccion !== 'ambos') {
      query.tipo = filtros.tipoTransaccion;
    }

    if (filtros.montoMinimo !== undefined) {
      query.monto = { ...query.monto, $gte: filtros.montoMinimo };
    }

    if (filtros.montoMaximo !== undefined) {
      query.monto = { ...query.monto, $lte: filtros.montoMaximo };
    }

    return query;
  }

  private async procesarIngresosGastos(transacciones: any[], historial: any[], monedaBase: string): Promise<{ totalIngresado: any; totalGastado: any }> {
    let totalIngresado = 0;
    let totalGastado = 0;
    const desglosePorMonedaIngresos = new Map();
    const desglosePorMonedaGastos = new Map();

    const transaccionesExtremas: Array<{ tipo: string; monto: number; fuente: string }> = [];

    for (const tx of transacciones) {
      const montoSanitizado = this.moneyValidationService.sanitizeAmount(tx.monto);
      
      const validacion = this.moneyValidationService.validateAmount(montoSanitizado, 'analytics');
      if (!validacion.isValid) {
        this.logger.warn(`Transacción inválida ignorada: ${validacion.error} - Monto: ${tx.monto}`);
        continue;
      }

      if (validacion.warning) {
        transaccionesExtremas.push({
          tipo: tx.tipo,
          monto: montoSanitizado,
          fuente: 'transaction'
        });
      }

      if (tx.tipo === 'ingreso') {
        totalIngresado += montoSanitizado;
        // Agregar al desglose por moneda
        const moneda = tx.moneda || monedaBase;
        const actualIngreso = desglosePorMonedaIngresos.get(moneda) || 0;
        desglosePorMonedaIngresos.set(moneda, actualIngreso + montoSanitizado);
      } else {
        totalGastado += montoSanitizado;
        // Agregar al desglose por moneda
        const moneda = tx.moneda || monedaBase;
        const actualGasto = desglosePorMonedaGastos.get(moneda) || 0;
        desglosePorMonedaGastos.set(moneda, actualGasto + montoSanitizado);
      }
    }

    // Procesar historial con validación
    for (const hist of historial) {
      const montoSanitizado = this.moneyValidationService.sanitizeAmount(Math.abs(hist.monto));
      
      const validacion = this.moneyValidationService.validateAmount(montoSanitizado, 'analytics');
      if (!validacion.isValid) {
        this.logger.warn(`Entrada de historial inválida ignorada: ${validacion.error} - Monto: ${hist.monto}`);
        continue;
      }

      if (validacion.warning) {
        transaccionesExtremas.push({
          tipo: hist.tipo,
          monto: montoSanitizado,
          fuente: 'history'
        });
      }

      if (hist.tipo === 'ingreso') {
        totalIngresado += montoSanitizado;
        const moneda = hist.moneda || monedaBase;
        const actualIngreso = desglosePorMonedaIngresos.get(moneda) || 0;
        desglosePorMonedaIngresos.set(moneda, actualIngreso + montoSanitizado);
      } else if (hist.tipo === 'egreso') {
        totalGastado += montoSanitizado;
        const moneda = hist.moneda || monedaBase;
        const actualGasto = desglosePorMonedaGastos.get(moneda) || 0;
        desglosePorMonedaGastos.set(moneda, actualGasto + montoSanitizado);
      }
    }

    // Log de transacciones extremas si las hay
    if (transaccionesExtremas.length > 0) {
      this.logger.warn(`Se detectaron ${transaccionesExtremas.length} transacciones de alto valor durante el análisis`);
    }

    // Sanitizar totales finales
    totalIngresado = this.moneyValidationService.sanitizeAmount(totalIngresado);
    totalGastado = this.moneyValidationService.sanitizeAmount(totalGastado);

    return {
      totalIngresado: {
        monto: totalIngresado,
        moneda: monedaBase,
        desglosePorMoneda: Array.from(desglosePorMonedaIngresos.entries()).map(([moneda, monto]) => ({
          moneda,
          monto: this.moneyValidationService.sanitizeAmount(monto as number),
          simbolo: '$' // Se puede mejorar integrando con MonedaService
        }))
      },
      totalGastado: {
        monto: totalGastado,
        moneda: monedaBase,
        desglosePorMoneda: Array.from(desglosePorMonedaGastos.entries()).map(([moneda, monto]) => ({
          moneda,
          monto: this.moneyValidationService.sanitizeAmount(monto as number),
          simbolo: '$' // Se puede mejorar integrando con MonedaService
        }))
      }
    };
  }

  private async calcularTotalSubcuentas(userId: string, filtros: AnalyticsFiltersDto, monedaBase: string): Promise<any> {
    const querySubcuentas: any = { userId };
    
    if (filtros.subcuentas?.length) {
      querySubcuentas.subCuentaId = { $in: filtros.subcuentas };
    }

    if (!filtros.incluirSubcuentasInactivas) {
      querySubcuentas.activa = true;
    }

    const subcuentas = await this.subcuentaModel.find(querySubcuentas);
    
    let totalMonto = 0;
    const subcuentasValidas: any[] = [];
    const subcuentasSospechosas: any[] = [];

    for (const sub of subcuentas) {
      const montoSanitizado = this.moneyValidationService.sanitizeAmount(sub.cantidad);
      
      const validacion = this.moneyValidationService.validateAmount(montoSanitizado, 'subcuenta');
      
      if (!validacion.isValid) {
        this.logger.warn(`Subcuenta con monto inválido ignorada: ${sub.nombre} - ${validacion.error}`);
        continue;
      }

      if (validacion.warning) {
        subcuentasSospechosas.push({
          id: sub.subCuentaId,
          nombre: sub.nombre,
          monto: montoSanitizado
        });
      }

      totalMonto += montoSanitizado;
      
      subcuentasValidas.push({
        subcuentaId: sub.subCuentaId,
        nombre: sub.nombre,
        monto: montoSanitizado,
        moneda: sub.moneda,
        simbolo: sub.simbolo || '$',
        activa: sub.activa
      });
    }

    if (subcuentasSospechosas.length > 0) {
      this.logger.warn(`Se detectaron ${subcuentasSospechosas.length} subcuentas con montos sospechosos para usuario ${userId}`);
    }

    return {
      monto: this.moneyValidationService.sanitizeAmount(totalMonto),
      moneda: monedaBase,
      desglosePorSubcuenta: subcuentasValidas
    };
  }

  private obtenerDescripcionPeriodo(filtros: AnalyticsFiltersDto): string {
    switch (filtros.rangoTiempo) {
      case 'dia':
        return 'Último día';
      case 'semana':
        return 'Última semana';
      case 'mes':
        return 'Último mes';
      case '3meses':
        return 'Últimos 3 meses';
      case '6meses':
        return 'Últimos 6 meses';
      case 'año':
        return 'Último año';
      case 'personalizado':
        return 'Período personalizado';
      default:
        return 'Período seleccionado';
    }
  }

  private async calcularCrecimientoMensual(subcuentaId: string, userId: string): Promise<number> {
    const ahora = new Date();
    const mesAnterior = new Date(ahora);
    mesAnterior.setMonth(ahora.getMonth() - 1);

    const transaccionesActuales = await this.transactionModel.find({
      userId,
      subCuentaId: subcuentaId,
      createdAt: { $gte: mesAnterior, $lte: ahora }
    });

    const balanceActual = transaccionesActuales.reduce((sum, tx) => 
      sum + (tx.tipo === 'ingreso' ? tx.monto : -tx.monto), 0
    );

    return balanceActual > 0 ? 5.0 : balanceActual < 0 ? -3.0 : 0.0;
  }

  private determinarPeriodoAnalisis(fechaInicio: Date, fechaFin: Date): 'diario' | 'semanal' | 'mensual' {
    const diferenciaDias = Math.ceil((fechaFin.getTime() - fechaInicio.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diferenciaDias <= 31) {
      return 'diario';
    } else if (diferenciaDias <= 90) {
      return 'semanal';
    } else {
      return 'mensual';
    }
  }

  private procesarDatosTemporal(resultados: any[], fechaInicio: Date, fechaFin: Date, periodo: string): AnalisisTemporalData[] {
    return resultados.map(resultado => ({
      fecha: resultado._id,
      ingresos: resultado.ingresos || 0,
      gastos: resultado.gastos || 0,
      balance: (resultado.ingresos || 0) - (resultado.gastos || 0),
      cantidadMovimientos: resultado.cantidadMovimientos || 0
    }));
  }

  private calcularTendencias(datos: AnalisisTemporalData[]): any {
    // Implementación simplificada
    return {
      ingresosTendencia: 'estable' as const,
      gastosTendencia: 'estable' as const,
      balanceTendencia: 'estable' as const
    };
  }

  private calcularPromedios(datos: AnalisisTemporalData[]): any {
    const totalDatos = datos.length;
    if (totalDatos === 0) {
      return { ingresoPromedio: 0, gastoPromedio: 0, balancePromedio: 0 };
    }

    return {
      ingresoPromedio: datos.reduce((sum, d) => sum + d.ingresos, 0) / totalDatos,
      gastoPromedio: datos.reduce((sum, d) => sum + d.gastos, 0) / totalDatos,
      balancePromedio: datos.reduce((sum, d) => sum + d.balance, 0) / totalDatos
    };
  }

  private async unificarMovimientos(transacciones: any[], historial: any[]): Promise<MovimientoDetallado[]> {
    const movimientos: MovimientoDetallado[] = [];

    // Procesar transacciones
    for (const tx of transacciones) {
      movimientos.push({
        id: tx.transaccionId,
        tipo: tx.tipo,
        fecha: tx.createdAt,
        monto: tx.monto,
        moneda: 'USD', // Se puede mejorar
        simbolo: '$',
        descripcion: tx.motivo || `Transacción ${tx.tipo}`,
        concepto: tx.concepto ? {
          id: tx.concepto,
          nombre: tx.concepto
        } : undefined,
        subcuenta: tx.subCuentaId ? {
          id: tx.subCuentaId,
          nombre: 'Subcuenta'
        } : undefined,
        esRecurrente: false,
        metadata: {}
      });
    }

    // Procesar historial
    for (const hist of historial) {
      movimientos.push({
        id: hist.id,
        tipo: hist.tipo === 'ingreso' ? 'ingreso' : 'egreso',
        fecha: hist.createdAt,
        monto: hist.monto,
        moneda: 'USD',
        simbolo: '$',
        descripcion: hist.descripcion,
        esRecurrente: hist.tipo === 'recurrente',
        metadata: hist.metadata
      });
    }

    return movimientos;
  }

  private ordenarMovimientos(movimientos: MovimientoDetallado[], filtros: MovimientosFiltersDto): MovimientoDetallado[] {
    const campo = filtros.ordenarPor || 'fecha';
    const direccion = filtros.ordenDireccion || 'desc';

    return movimientos.sort((a, b) => {
      let valorA, valorB;

      switch (campo) {
        case 'fecha':
          valorA = a.fecha.getTime();
          valorB = b.fecha.getTime();
          break;
        case 'monto':
          valorA = a.monto;
          valorB = b.monto;
          break;
        case 'concepto':
          valorA = a.concepto?.nombre || '';
          valorB = b.concepto?.nombre || '';
          break;
        default:
          valorA = a.fecha.getTime();
          valorB = b.fecha.getTime();
      }

      if (direccion === 'asc') {
        return valorA > valorB ? 1 : -1;
      } else {
        return valorA < valorB ? 1 : -1;
      }
    });
  }

  private calcularResumenPagina(movimientos: MovimientoDetallado[]): any {
    return {
      totalIngresos: movimientos
        .filter(m => m.tipo === 'ingreso')
        .reduce((sum, m) => sum + m.monto, 0),
      totalGastos: movimientos
        .filter(m => m.tipo === 'egreso')
        .reduce((sum, m) => sum + m.monto, 0),
      balance: movimientos.reduce((sum, m) => 
        sum + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0
      )
    };
  }

  private async obtenerDatosPeriodo(userId: string, fechaInicio: Date, fechaFin: Date): Promise<any> {
    const transacciones = await this.transactionModel.find({
      userId,
      createdAt: { $gte: fechaInicio, $lte: fechaFin }
    });

    const ingresos = transacciones.filter(t => t.tipo === 'ingreso').reduce((sum, t) => sum + t.monto, 0);
    const gastos = transacciones.filter(t => t.tipo === 'egreso').reduce((sum, t) => sum + t.monto, 0);

    return {
      ingresos,
      gastos,
      balance: ingresos - gastos,
      movimientos: transacciones.length
    };
  }

  private calcularCambiosPeriodos(actuales: any, anteriores: any): any {
    const calcularCambio = (actual: number, anterior: number) => ({
      absoluto: actual - anterior,
      porcentual: anterior !== 0 ? ((actual - anterior) / anterior) * 100 : 0
    });

    return {
      ingresos: calcularCambio(actuales.ingresos, anteriores.ingresos),
      gastos: calcularCambio(actuales.gastos, anteriores.gastos),
      balance: calcularCambio(actuales.balance, anteriores.balance),
      movimientos: calcularCambio(actuales.movimientos, anteriores.movimientos)
    };
  }
}
