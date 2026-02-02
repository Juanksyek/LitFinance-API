import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Recurrente, RecurrenteDocument } from './schemas/recurrente.schema';
import { CrearRecurrenteDto } from './dto/crear-recurrente.dto';
import { EditarRecurrenteDto } from './dto/editar-recurrente.dto';
import { HistorialRecurrente, HistorialRecurrenteDocument } from './schemas/historial-recurrente.schema';
import { generateUniqueId } from 'src/utils/generate-id';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { CuentaService } from '../cuenta/cuenta.service';
import { Cuenta, CuentaDocument } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta, SubcuentaDocument } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';
import { MonedaService } from '../moneda/moneda.service';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
import { ConversionService } from '../utils/services/conversion.service';
import { UserService } from '../user/user.service';
import { PlanConfigService } from '../plan-config/plan-config.service';
import { DashboardVersionService } from '../user/services/dashboard-version.service';

@Injectable()
export class RecurrentesService {
  constructor(
    @InjectModel(Recurrente.name) private readonly recurrenteModel: Model<RecurrenteDocument>,
    @InjectModel(HistorialRecurrente.name) private readonly historialModel: Model<HistorialRecurrenteDocument>,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
    @InjectModel(Subcuenta.name) private readonly subcuentaModel: Model<SubcuentaDocument>,
    private readonly notificacionesService: NotificacionesService,
    private readonly cuentaService: CuentaService,
    private readonly monedaService: MonedaService,
    private readonly cuentaHistorialService: CuentaHistorialService,
    private readonly conversionService: ConversionService,
    private readonly userService: UserService,
    private readonly planConfigService: PlanConfigService,
    private readonly dashboardVersionService: DashboardVersionService,
  ) {}

  async crear(dto: CrearRecurrenteDto, userId: string): Promise<Recurrente> {
    const recurrenteId = await generateUniqueId(this.recurrenteModel, 'recurrenteId');
    const cuenta: CuentaDocument = await this.cuentaService.obtenerCuentaPrincipal(userId);

    // Default para compatibilidad con recurrentes existentes
    const tipoRecurrente = dto.tipoRecurrente || 'indefinido';

    // Validación: si es plazo_fijo, totalPagos es obligatorio
    if (tipoRecurrente === 'plazo_fijo' && (!dto.totalPagos || dto.totalPagos <= 0)) {
      throw new BadRequestException(
        'totalPagos es obligatorio y debe ser mayor a 0 cuando tipoRecurrente es plazo_fijo'
      );
    }

    // Calcular fechas para plazo_fijo
    const fechaInicio = dto.fechaInicio || new Date();
    let fechaFin: Date | undefined;

    if (tipoRecurrente === 'plazo_fijo' && dto.totalPagos) {
      fechaFin = this.calcularFechaFin(
        fechaInicio,
        dto.frecuenciaTipo,
        dto.frecuenciaValor,
        dto.totalPagos
      );
    }

    // Registrar creación de recurrente en historial
    await this.cuentaHistorialService.registrarMovimiento({
      cuentaId: dto.cuentaId || cuenta.id,
      userId,
      tipo: 'recurrente',
      descripcion: `Recurrente creado: "${dto.nombre}" - ${dto.monto} ${dto.moneda}${tipoRecurrente === 'plazo_fijo' ? ` (${dto.totalPagos} pagos)` : ''}`,
      monto: 0,
      fecha: new Date().toISOString(),
      conceptoId: undefined,
      subcuentaId: dto.subcuentaId,
      metadata: {
        accion: 'crear',
        recurrenteId,
        moneda: dto.moneda,
        monto: dto.monto,
        afectaCuentaPrincipal: dto.afectaCuentaPrincipal,
        afectaSubcuenta: dto.afectaSubcuenta,
        tipoRecurrente,
        totalPagos: dto.totalPagos,
      },
    });

    const nuevo = new this.recurrenteModel({
      ...dto,
      recurrenteId,
      userId,
      tipoRecurrente,
      pagosRealizados: 0,
      fechaInicio: tipoRecurrente === 'plazo_fijo' ? fechaInicio : undefined,
      fechaFin: tipoRecurrente === 'plazo_fijo' ? fechaFin : undefined,
      proximaEjecucion: this.calcularProximaFechaPersonalizada(
        new Date(),
        dto.frecuenciaTipo,
        dto.frecuenciaValor
      ),
    });

    await this.dashboardVersionService.touchDashboard(userId, 'recurrente.create');

    return await nuevo.save();
  }

  // Método auxiliar para calcular la fecha de finalización
  private calcularFechaFin(
    fechaInicio: Date,
    frecuenciaTipo: string,
    frecuenciaValor: string,
    totalPagos: number
  ): Date {
    let fechaFin = new Date(fechaInicio);

    for (let i = 0; i < totalPagos; i++) {
      fechaFin = this.calcularProximaFechaPersonalizada(
        fechaFin,
        frecuenciaTipo,
        frecuenciaValor
      );
    }

    return fechaFin;
  }

  calcularProximaFechaPersonalizada(
    fechaBase: Date,
    frecuenciaTipo: string,
    frecuenciaValor: string,
  ): Date {
    const hoy = new Date(fechaBase);
    hoy.setHours(0, 0, 0, 0);

    if (frecuenciaTipo === 'dia_semana') {
      const diaSemana = parseInt(frecuenciaValor);
      const diaActual = hoy.getDay();
      const diasHasta = (diaSemana + 7 - diaActual) % 7 || 7;
      hoy.setDate(hoy.getDate() + diasHasta);
      return hoy;
    }

    if (frecuenciaTipo === 'dia_mes') {
      const diaObjetivo = parseInt(frecuenciaValor);
      const diaHoy = hoy.getDate();
      const mes = hoy.getMonth();
      const anio = hoy.getFullYear();

      if (diaHoy < diaObjetivo) {
        hoy.setDate(diaObjetivo);
        return hoy;
      } else {
        const siguienteMes = new Date(anio, mes + 1, 1);
        const ultimoDiaDelMes = new Date(anio, mes + 2, 0).getDate();
        siguienteMes.setDate(Math.min(diaObjetivo, ultimoDiaDelMes));
        return siguienteMes;
      }
    }

    if (frecuenciaTipo === 'fecha_anual') {
      const [mesStr, diaStr] = frecuenciaValor.split('-');
      const dia = parseInt(diaStr);
      const mes = parseInt(mesStr) - 1;
      const anio = hoy.getFullYear();

      const fechaObjetivo = new Date(anio, mes, dia);
      if (fechaObjetivo < hoy) {
        fechaObjetivo.setFullYear(anio + 1);
      }

      return fechaObjetivo;
    }

    return hoy;
  }

  async listar(userId: string, page = 1, limit = 10, search = '', subcuentaId?: string) {
    const skip = (page - 1) * limit;
    const filtroBase: any = {
      userId,
      ...(search && { nombre: { $regex: search, $options: 'i' } }),
      ...(subcuentaId && { subcuentaId }),
    };
  
    const [items, total] = await Promise.all([
      this.recurrenteModel
        .find(filtroBase)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.recurrenteModel.countDocuments(filtroBase),
    ]);

    // Obtener el planType del usuario para calcular límites
    let itemsWithPauseStatus = items;
    try {
      const userProfile = await this.userService.getProfile(userId);
      const planType = userProfile?.planType || 'free_plan';
      
      // 🔥 Consultar límite dinámicamente desde PlanConfig
      const planConfig = await this.planConfigService.findByPlanType(planType);
      const planLimit = planConfig?.recurrentesPorUsuario === -1 
        ? Infinity 
        : (planConfig?.recurrentesPorUsuario || 10);
      
      console.log('🔍 [RecurrentesService] Aplicando límites:', {
        userId,
        totalCount: total,
        planLimit,
        planType,
        currentPage: page,
        skip,
      });
      
      // Si excede el límite, marcar los más antiguos como pausados
      if (total > planLimit) {
        const startIndex = skip;
        
        itemsWithPauseStatus = items.map((rec, localIndex) => {
          const globalIndex = startIndex + localIndex;
          
          // Los primeros 'planLimit' items globalmente están activos
          // Los demás están pausados
          const shouldBePaused = globalIndex >= planLimit;
          
          return {
            ...rec,
            pausadoPorPlan: shouldBePaused || rec.pausadoPorPlan || false,
          };
        });
        
        console.log('✅ [RecurrentesService] Items marcados:', 
          itemsWithPauseStatus.map((r, i) => ({
            nombre: r.nombre,
            globalIndex: startIndex + i,
            pausadoPorPlan: r.pausadoPorPlan,
          }))
        );
      }
    } catch (error) {
      console.error('❌ [RecurrentesService] Error al aplicar límites:', error.message);
      // En caso de error, devolver items sin modificar
    }
  
    return {
      items: itemsWithPauseStatus,
      total,
      page,
      hasNextPage: page * limit < total,
    };
  }

  async obtenerPorId(recurrenteId: string): Promise<Recurrente> {
    const encontrado = await this.recurrenteModel.findOne({ recurrenteId });
    if (!encontrado) throw new NotFoundException('Recurrente no encontrado');
    return encontrado;
  }

  async editar(recurrenteId: string, dto: EditarRecurrenteDto): Promise<Recurrente> {
    if (!dto.frecuenciaTipo || typeof dto.frecuenciaValor !== 'string') {
      throw new ForbiddenException('frecuenciaTipo y frecuenciaValor son requeridos para actualizar la próxima ejecución');
    }
    
    const recurrente = await this.recurrenteModel.findOne({ recurrenteId });
    if (!recurrente) throw new NotFoundException('Recurrente no encontrado para editar');

    const actualizado = await this.recurrenteModel.findOneAndUpdate(
      { recurrenteId },
      {
        ...dto,
        proximaEjecucion: this.calcularProximaFechaPersonalizada(
          new Date(),
          dto.frecuenciaTipo,
          dto.frecuenciaValor,
        ),
      },
      { new: true },
    );

    if (!actualizado) throw new NotFoundException('No se pudo actualizar el recurrente');

    // Registrar modificación en historial
    const cuenta = await this.cuentaService.obtenerCuentaPrincipal(recurrente.userId);
    await this.cuentaHistorialService.registrarMovimiento({
      cuentaId: cuenta.id,
      userId: recurrente.userId,
      tipo: 'recurrente',
      descripcion: `Recurrente modificado: "${dto.nombre || recurrente.nombre}"`,
      monto: 0,
      fecha: new Date().toISOString(),
      conceptoId: undefined,
      subcuentaId: dto.subcuentaId || recurrente.subcuentaId,
      metadata: {
        accion: 'modificar',
        recurrenteId,
        cambios: dto,
      },
    });

    await this.dashboardVersionService.touchDashboard(recurrente.userId, 'recurrente.update');

    return actualizado;
  }

  async eliminar(recurrenteId: string): Promise<{ eliminado: boolean; mensaje: string }> {
    const recurrente = await this.recurrenteModel.findOne({ recurrenteId });
    
    if (!recurrente) {
      return {
        eliminado: false,
        mensaje: `No se encontró un recurrente con ID ${recurrenteId}.`,
      };
    }

    // Registrar eliminación en historial antes de borrar
    const cuenta = await this.cuentaService.obtenerCuentaPrincipal(recurrente.userId);
    await this.cuentaHistorialService.registrarMovimiento({
      cuentaId: cuenta.id,
      userId: recurrente.userId,
      tipo: 'recurrente',
      descripcion: `Recurrente eliminado: "${recurrente.nombre}" - ${recurrente.monto} ${recurrente.moneda}`,
      monto: 0,
      fecha: new Date().toISOString(),
      conceptoId: undefined,
      subcuentaId: recurrente.subcuentaId,
      metadata: {
        accion: 'eliminar',
        recurrenteId,
        nombre: recurrente.nombre,
        monto: recurrente.monto,
        moneda: recurrente.moneda,
      },
    });

    const res = await this.recurrenteModel.deleteOne({ recurrenteId });

    if (res.deletedCount > 0) {

      await this.dashboardVersionService.touchDashboard(recurrente.userId, 'recurrente.delete');
      return {
        eliminado: true,
        mensaje: `El recurrente con ID ${recurrenteId} fue eliminado correctamente.`,
      };
    } else {
      return {
        eliminado: false,
        mensaje: `No se encontró un recurrente con ID ${recurrenteId}.`,
      };
    }
  }

  async verificarRecordatoriosDelDia(): Promise<void> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const recurrentes = await this.recurrenteModel.find({
      pausado: { $ne: true },
      pausadoPorPlan: { $ne: true },
      estado: { $nin: ['pausado', 'completado'] },
    });

    for (const r of recurrentes) {
      if (!r.recordatorios || r.recordatorios.length === 0) continue;

      for (const diasAntes of r.recordatorios) {
        const fechaRecordatorio = new Date(r.proximaEjecucion);
        fechaRecordatorio.setDate(fechaRecordatorio.getDate() - diasAntes);

        if (fechaRecordatorio.toDateString() === hoy.toDateString()) {
          const titulo = '📅 Recordatorio de pago';
          const mensaje = `Tu recurrente "${r.nombre}" se cobrará el ${r.proximaEjecucion.toLocaleDateString()}.`;

          await this.notificacionesService.enviarNotificacionPush(
            r.userId,
            titulo,
            mensaje
          );
        }
      }
    }
  }

  async ejecutarRecurrentesDelDia(): Promise<{ ejecutados: number; exitosos: number; fallidos: number }> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const mañana = new Date(hoy);
    mañana.setDate(hoy.getDate() + 1);

    const recurrentes = await this.recurrenteModel.find({
      proximaEjecucion: { $gte: hoy, $lt: mañana },
      pausado: { $ne: true },
      pausadoPorPlan: { $ne: true },
      estado: { $nin: ['ejecutando', 'completado', 'pausado'] }, // Excluir completados/pausados
    });

    let exitosos = 0;
    let fallidos = 0;

    for (const r of recurrentes) {
      try {
        // ===========================
        // VALIDACIÓN: Plazo Fijo Completado
        // ===========================
        if (r.tipoRecurrente === 'plazo_fijo') {
          if (r.pagosRealizados >= (r.totalPagos || 0)) {
            // Marcar como completado y desactivar
            r.estado = 'completado';
            r.pausado = true;
            await r.save();
            
            // Registrar finalización en historial
            await this.historialModel.create({
              recurrenteId: r.recurrenteId,
              monto: 0,
              moneda: r.moneda,
              cuentaId: r.cuentaId,
              subcuentaId: r.subcuentaId,
              afectaCuentaPrincipal: r.afectaCuentaPrincipal,
              fecha: new Date(),
              userId: r.userId,
              estado: 'exitoso',
              nombreRecurrente: r.nombre,
              plataforma: r.plataforma,
              mensajeError: undefined,
              numeroPago: r.pagosRealizados,
              totalPagos: r.totalPagos,
              tipoRecurrente: r.tipoRecurrente,
            });

            continue; // Saltar a siguiente recurrente
          }
        }

        // Marcar como ejecutando
        r.estado = 'ejecutando';
        await r.save();

        // Obtener cuenta principal
        const cuenta = await this.cuentaService.obtenerCuentaPrincipal(r.userId);

        let montoConvertidoSubcuenta = r.monto;
        let tasaConversionSubcuenta = 1;
        let monedaDestinoSubcuenta: string | null = null;

        let montoConvertidoCuenta = r.monto;
        let tasaConversionCuenta = 1;
        let monedaDestinoCuenta: string | null = null;

        // DESCUENTO REAL DE SALDOS CON CONVERSIÓN AUTOMÁTICA
        if (r.afectaSubcuenta && r.subcuentaId) {
          // Verificar que subcuenta existe
          const subcuenta = await this.subcuentaModel.findOne({ 
            subCuentaId: r.subcuentaId, 
            userId: r.userId 
          });
          
          if (!subcuenta) {
            throw new NotFoundException(`Subcuenta ${r.subcuentaId} no encontrada`);
          }

          monedaDestinoSubcuenta = subcuenta.moneda;

          // CONVERSIÓN: Solo si la moneda del recurrente es diferente a la de la subcuenta
          if (r.moneda !== subcuenta.moneda) {
            const conversion = await this.conversionService.convertir(
              r.monto,
              r.moneda,
              subcuenta.moneda,
            );
            montoConvertidoSubcuenta = conversion.montoConvertido;
            tasaConversionSubcuenta = conversion.tasaConversion;
          }

          // Verificar saldo suficiente
          if (subcuenta.cantidad < montoConvertidoSubcuenta) {
            throw new BadRequestException(
              `Saldo insuficiente en subcuenta "${subcuenta.nombre}". Disponible: ${subcuenta.cantidad} ${subcuenta.moneda}, Requerido: ${montoConvertidoSubcuenta} ${subcuenta.moneda}`
            );
          }

          // Descontar de subcuenta
          await this.subcuentaModel.updateOne(
            { subCuentaId: r.subcuentaId, userId: r.userId },
            { $inc: { cantidad: -montoConvertidoSubcuenta } }
          );
        }

        if (r.afectaCuentaPrincipal) {
          // Verificar que cuenta existe y tiene saldo
          const cuentaDoc = await this.cuentaModel.findOne({ 
            id: cuenta.id, 
            userId: r.userId 
          });
          
          if (!cuentaDoc) {
            throw new NotFoundException('Cuenta principal no encontrada');
          }

          monedaDestinoCuenta = cuentaDoc.moneda;

          // CONVERSIÓN: Solo si la moneda del recurrente es diferente a la de la cuenta
          if (r.moneda !== cuentaDoc.moneda) {
            const conversion = await this.conversionService.convertir(
              r.monto,
              r.moneda,
              cuentaDoc.moneda,
            );
            montoConvertidoCuenta = conversion.montoConvertido;
            tasaConversionCuenta = conversion.tasaConversion;
          }

          // Verificar saldo suficiente
          if (cuentaDoc.cantidad < montoConvertidoCuenta) {
            throw new BadRequestException(
              `Saldo insuficiente en cuenta principal. Disponible: ${cuentaDoc.cantidad} ${cuentaDoc.moneda}, Requerido: ${montoConvertidoCuenta} ${cuentaDoc.moneda}`
            );
          }

          // Descontar de cuenta principal
          await this.cuentaModel.updateOne(
            { id: cuenta.id, userId: r.userId },
            { $inc: { cantidad: -montoConvertidoCuenta } }
          );
        }

        // Guardar conversión en el documento recurrente para referencia (mantener compatibilidad)
        const montoConvertido = r.afectaCuentaPrincipal ? montoConvertidoCuenta : montoConvertidoSubcuenta;
        const tasaConversion = r.afectaCuentaPrincipal ? tasaConversionCuenta : tasaConversionSubcuenta;

        r.montoConvertido = montoConvertido;
        r.tasaConversion = tasaConversion;
        r.fechaConversion = new Date();

        // ===========================
        // INCREMENTAR PAGOS REALIZADOS (para plazo_fijo)
        // ===========================
        if (r.tipoRecurrente === 'plazo_fijo') {
          r.pagosRealizados += 1;
        }

        // Registrar en historial de recurrentes
        const montoFinalConvertido = r.afectaSubcuenta ? montoConvertidoSubcuenta : montoConvertidoCuenta;
        const tasaFinalConversion = r.afectaSubcuenta ? tasaConversionSubcuenta : tasaConversionCuenta;
        const monedaFinalConvertida = r.afectaSubcuenta ? monedaDestinoSubcuenta : monedaDestinoCuenta;
        
        await this.historialModel.create({
          recurrenteId: r.recurrenteId,
          monto: r.monto,
          moneda: r.moneda,
          montoConvertido: montoFinalConvertido,
          monedaConvertida: monedaFinalConvertida,
          tasaConversion: tasaFinalConversion,
          montoConvertidoCuenta: r.afectaCuentaPrincipal ? montoConvertidoCuenta : null,
          monedaConvertidaCuenta: r.afectaCuentaPrincipal ? monedaDestinoCuenta : null,
          tasaConversionCuenta: r.afectaCuentaPrincipal ? tasaConversionCuenta : null,
          montoConvertidoSubcuenta: r.afectaSubcuenta ? montoConvertidoSubcuenta : null,
          monedaConvertidaSubcuenta: r.afectaSubcuenta ? monedaDestinoSubcuenta : null,
          tasaConversionSubcuenta: r.afectaSubcuenta ? tasaConversionSubcuenta : null,
          cuentaId: cuenta.id,
          subcuentaId: r.subcuentaId,
          afectaCuentaPrincipal: r.afectaCuentaPrincipal,
          fecha: new Date(),
          userId: r.userId,
          estado: 'exitoso',
          nombreRecurrente: r.nombre,
          plataforma: r.plataforma,
          // Campos de plazo_fijo
          numeroPago: r.tipoRecurrente === 'plazo_fijo' ? r.pagosRealizados : undefined,
          totalPagos: r.tipoRecurrente === 'plazo_fijo' ? r.totalPagos : undefined,
          tipoRecurrente: r.tipoRecurrente,
        });

        // Registrar en historial de cuenta
        await this.cuentaHistorialService.registrarMovimiento({
          cuentaId: cuenta.id,
          userId: r.userId,
          tipo: 'recurrente',
          descripcion: `Cargo recurrente: ${r.nombre} (${r.plataforma.nombre})`,
          monto: -(r.afectaCuentaPrincipal ? montoConvertidoCuenta : montoFinalConvertido),
          fecha: new Date().toISOString(),
          conceptoId: undefined,
          subcuentaId: r.subcuentaId,
          metadata: {
            recurrenteId: r.recurrenteId,
            monedaOrigen: r.moneda,
            montoOriginal: r.monto,
            conversionCuenta: r.afectaCuentaPrincipal
              ? {
                  monedaDestino: monedaDestinoCuenta,
                  montoDestino: -montoConvertidoCuenta,
                  tasaConversion: tasaConversionCuenta,
                }
              : null,
            conversionSubcuenta: r.afectaSubcuenta
              ? {
                  monedaDestino: monedaDestinoSubcuenta,
                  montoDestino: -montoConvertidoSubcuenta,
                  tasaConversion: tasaConversionSubcuenta,
                }
              : null,
            plataforma: r.plataforma.nombre,
            afectaCuentaPrincipal: r.afectaCuentaPrincipal,
            afectaSubcuenta: r.afectaSubcuenta,
          },
        });

        // Notificación de cobro (incluye concepto/título/monto)
        let tituloNotificacion = `Pago recurrente: ${r.nombre}`;
        
        // Si es plazo_fijo, agregar progreso al título
        if (r.tipoRecurrente === 'plazo_fijo' && r.totalPagos) {
          tituloNotificacion += ` (${r.pagosRealizados}/${r.totalPagos})`;
        }
        
        // Determinar qué conversión mostrar (prioridad: subcuenta > cuenta)
        let lineaMonto: string;
        if (r.afectaSubcuenta && monedaDestinoSubcuenta && r.moneda !== monedaDestinoSubcuenta) {
          lineaMonto = `${r.monto} ${r.moneda} → ${montoConvertidoSubcuenta.toFixed(2)} ${monedaDestinoSubcuenta}`;
        } else if (r.afectaCuentaPrincipal && monedaDestinoCuenta && r.moneda !== monedaDestinoCuenta) {
          lineaMonto = `${r.monto} ${r.moneda} → ${montoConvertidoCuenta.toFixed(2)} ${monedaDestinoCuenta}`;
        } else {
          lineaMonto = `${r.monto} ${r.moneda}`;
        }
        
        let mensajeNotificacion = `${lineaMonto}${r.plataforma?.nombre ? ` • ${r.plataforma.nombre}` : ''}`;
        
        // Si es plazo_fijo y es el último pago, agregar mensaje
        if (r.tipoRecurrente === 'plazo_fijo' && r.pagosRealizados === r.totalPagos) {
          mensajeNotificacion += ' 🎉 ¡Último pago completado!';
        }

        await this.notificacionesService.enviarNotificacionPush(
          r.userId,
          tituloNotificacion,
          mensajeNotificacion,
          {
            tipo: 'recurrente_cobrado',
            recurrenteId: r.recurrenteId,
            concepto: r.nombre,
            monto: r.monto,
            moneda: r.moneda,
            montoConvertidoCuenta: r.afectaCuentaPrincipal ? montoConvertidoCuenta : null,
            monedaCuenta: r.afectaCuentaPrincipal ? monedaDestinoCuenta : null,
            montoConvertidoSubcuenta: r.afectaSubcuenta ? montoConvertidoSubcuenta : null,
            monedaSubcuenta: r.afectaSubcuenta ? monedaDestinoSubcuenta : null,
            subcuentaId: r.subcuentaId ?? null,
            // Agregar info de plazo_fijo
            tipoRecurrente: r.tipoRecurrente,
            pagosRealizados: r.tipoRecurrente === 'plazo_fijo' ? r.pagosRealizados : undefined,
            totalPagos: r.tipoRecurrente === 'plazo_fijo' ? r.totalPagos : undefined,
          },
        );

        // Actualizar próxima ejecución
        if (r.frecuenciaTipo && r.frecuenciaValor) {
          r.proximaEjecucion = this.calcularProximaFechaPersonalizada(
            new Date(),
            r.frecuenciaTipo,
            r.frecuenciaValor
          );
        }

        r.estado = 'activo';
        r.ultimaEjecucion = new Date();
        r.mensajeError = undefined;
        await r.save();

        exitosos++;
      } catch (error) {
        // Registrar error
        r.estado = 'error';
        r.mensajeError = error.message;
        await r.save();

        await this.historialModel.create({
          recurrenteId: r.recurrenteId,
          monto: r.monto,
          moneda: r.moneda,
          cuentaId: r.cuentaId,
          subcuentaId: r.subcuentaId,
          afectaCuentaPrincipal: r.afectaCuentaPrincipal,
          fecha: new Date(),
          userId: r.userId,
          estado: 'fallido',
          mensajeError: error.message,
          nombreRecurrente: r.nombre,
          plataforma: r.plataforma,
        });

        fallidos++;
      }
    }

    return { ejecutados: recurrentes.length, exitosos, fallidos };
  }

  async pausarRecurrente(recurrenteId: string, userId: string) {
    const recurrente = await this.recurrenteModel.findOne({ recurrenteId });
    if (!recurrente) throw new NotFoundException('Recurrente no encontrado');
  
    if (recurrente.userId !== userId)
      throw new ForbiddenException('No tienes permisos para pausar este recurrente');
  
    recurrente.pausado = true;
    await recurrente.save();
  
    await this.historialModel.create({
      recurrenteId: recurrente.recurrenteId,
      nombreRecurrente: recurrente.nombre,
      plataforma: recurrente.plataforma,
      monto: 0,
      moneda: recurrente.moneda,
      cuentaId: recurrente.cuentaId,
      subcuentaId: recurrente.subcuentaId,
      afectaCuentaPrincipal: recurrente.afectaCuentaPrincipal,
      fecha: new Date(),
      userId: recurrente.userId,
      estado: 'pausado',
      mensajeError: undefined,
      observacion: '⏸ Recurrente pausado por el usuario',
    });

    await this.dashboardVersionService.touchDashboard(userId, 'recurrente.pause');
  
    return { mensaje: `Recurrente "${recurrente.nombre}" pausado correctamente.` };
  }

  async reanudarRecurrente(recurrenteId: string, userId: string) {
    const recurrente = await this.recurrenteModel.findOne({ recurrenteId });
    if (!recurrente) throw new NotFoundException('Recurrente no encontrado');
  
    if (recurrente.userId !== userId)
      throw new ForbiddenException('No tienes permisos para reanudar este recurrente');
  
    recurrente.pausado = false;
    await recurrente.save();
  
    await this.historialModel.create({
      recurrenteId: recurrente.recurrenteId,
      nombreRecurrente: recurrente.nombre,
      plataforma: recurrente.plataforma,
      monto: 0,
      moneda: recurrente.moneda,
      cuentaId: recurrente.cuentaId,
      subcuentaId: recurrente.subcuentaId,
      afectaCuentaPrincipal: recurrente.afectaCuentaPrincipal,
      fecha: new Date(),
      userId: recurrente.userId,
      estado: 'activo',
      mensajeError: undefined,
      observacion: '▶️ Recurrente reanudado por el usuario',
    });

    await this.dashboardVersionService.touchDashboard(userId, 'recurrente.resume');
  
    return { mensaje: `Recurrente \"${recurrente.nombre}\" reanudado correctamente.` };
  }

  async obtenerEstadisticasHistorial(
    userId: string,
    filtro: 'año' | 'mes' | 'quincena' | 'semana'
  ): Promise<{
    totalCobrado: number;
    cantidadEjecuciones: number;
    porRecurrente: Array<{ nombre: string; total: number; cantidad: number }>;
    periodo: { inicio: Date; fin: Date };
  }> {
    // Calcular fechas según filtro
    const ahora = new Date();
    let fechaInicio = new Date();

    switch (filtro) {
      case 'año':
        fechaInicio.setFullYear(ahora.getFullYear() - 1);
        break;
      case 'mes':
        fechaInicio.setMonth(ahora.getMonth() - 1);
        break;
      case 'quincena':
        fechaInicio.setDate(ahora.getDate() - 15);
        break;
      case 'semana':
        fechaInicio.setDate(ahora.getDate() - 7);
        break;
    }

    // Obtener historial de recurrentes exitosos en el periodo
    const historial = await this.historialModel.find({
      userId,
      fecha: { $gte: fechaInicio, $lte: ahora },
      estado: 'exitoso',
    });

    // Calcular total cobrado
    const totalCobrado = historial.reduce((sum, item) => {
      return sum + (item.montoConvertido || item.monto);
    }, 0);

    // Agrupar por recurrente
    const agrupado = new Map<string, { total: number; cantidad: number }>();

    historial.forEach((item) => {
      const nombre = item.nombreRecurrente || 'Sin nombre';
      const existente = agrupado.get(nombre) || { total: 0, cantidad: 0 };
      existente.total += item.montoConvertido || item.monto;
      existente.cantidad += 1;
      agrupado.set(nombre, existente);
    });

    const porRecurrente = Array.from(agrupado.entries()).map(([nombre, data]) => ({
      nombre,
      total: data.total,
      cantidad: data.cantidad,
    }));

    return {
      totalCobrado,
      cantidadEjecuciones: historial.length,
      porRecurrente,
      periodo: { inicio: fechaInicio, fin: ahora },
    };
  }

  async ejecutarRecurrenteTest(recurrenteId: string, userId: string): Promise<any> {
    // Verificar que el recurrente existe y pertenece al usuario
    const recurrente = await this.recurrenteModel.findOne({ recurrenteId, userId });
    
    if (!recurrente) {
      throw new NotFoundException('Recurrente no encontrado o no tienes permisos');
    }

    if ((recurrente as any).pausadoPorPlan) {
      throw new BadRequestException('Este recurrente está pausado por plan y no puede ejecutarse en test');
    }

    // Guardar la fecha original
    const fechaOriginal = recurrente.proximaEjecucion;

    try {
      // Cambiar temporalmente la próxima ejecución a ahora
      await this.recurrenteModel.updateOne(
        { recurrenteId },
        { 
          $set: { 
            proximaEjecucion: new Date(),
            pausado: false // Asegurar que no esté pausado (solo para test)
          } 
        }
      );

      // Ejecutar el cron
      const result = await this.ejecutarRecurrentesDelDia();

      // Obtener el estado actualizado del recurrente
      const recurrenteActualizado = await this.recurrenteModel.findOne({ recurrenteId });

      return {
        mensaje: '✅ Recurrente ejecutado exitosamente para prueba',
        recurrenteId,
        nombre: recurrente.nombre,
        montoOriginal: recurrente.monto,
        monedaOriginal: recurrente.moneda,
        resultadoEjecucion: result,
        estado: recurrenteActualizado?.estado,
        mensajeError: recurrenteActualizado?.mensajeError,
        proximaEjecucion: recurrenteActualizado?.proximaEjecucion,
        instrucciones: 'Verifica el historial en /api/cuenta-historial y el saldo de tu cuenta/subcuenta'
      };
    } catch (error) {
      // Restaurar la fecha original si algo falla
      await this.recurrenteModel.updateOne(
        { recurrenteId },
        { $set: { proximaEjecucion: fechaOriginal } }
      );
      throw error;
    }
  }

  async contarRecurrentes(userId: string): Promise<number> {
    return this.recurrenteModel.countDocuments({ userId, estado: 'activo' });
  }
}
