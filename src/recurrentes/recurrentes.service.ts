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
  ) {}

  async crear(dto: CrearRecurrenteDto, userId: string): Promise<Recurrente> {
    const recurrenteId = await generateUniqueId(this.recurrenteModel, 'recurrenteId');
    const cuenta: CuentaDocument = await this.cuentaService.obtenerCuentaPrincipal(userId);

    // Registrar creación de recurrente en historial
    await this.cuentaHistorialService.registrarMovimiento({
      cuentaId: dto.cuentaId || cuenta.id,
      userId,
      tipo: 'recurrente',
      descripcion: `Recurrente creado: "${dto.nombre}" - ${dto.monto} ${dto.moneda}`,
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
      },
    });

    const nuevo = new this.recurrenteModel({
      ...dto,
      recurrenteId,
      userId,
      proximaEjecucion: this.calcularProximaFechaPersonalizada(
        new Date(),
        dto.frecuenciaTipo,
        dto.frecuenciaValor
      ),
    });

    return await nuevo.save();
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
        .exec(),
      this.recurrenteModel.countDocuments(filtroBase),
    ]);
  
    return {
      items,
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

    const recurrentes = await this.recurrenteModel.find();

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
      estado: { $ne: 'ejecutando' },
    });

    let exitosos = 0;
    let fallidos = 0;

    for (const r of recurrentes) {
      try {
        // Marcar como ejecutando
        r.estado = 'ejecutando';
        await r.save();

        // Obtener cuenta principal
        const cuenta = await this.cuentaService.obtenerCuentaPrincipal(r.userId);

        let montoConvertidoSubcuenta = r.monto;
        let tasaConversionSubcuenta = 1;
        let montoConvertidoCuenta = r.monto;
        let tasaConversionCuenta = 1;

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

        // Guardar conversión en el documento recurrente para referencia
        const montoConvertido = r.afectaSubcuenta ? montoConvertidoSubcuenta : montoConvertidoCuenta;
        const tasaConversion = r.afectaSubcuenta ? tasaConversionSubcuenta : tasaConversionCuenta;
        
        r.montoConvertido = montoConvertido;
        r.tasaConversion = tasaConversion;
        r.fechaConversion = new Date();

        // Registrar en historial de recurrentes
        const montoFinalConvertido = r.afectaSubcuenta ? montoConvertidoSubcuenta : montoConvertidoCuenta;
        const tasaFinalConversion = r.afectaSubcuenta ? tasaConversionSubcuenta : tasaConversionCuenta;
        
        await this.historialModel.create({
          recurrenteId: r.recurrenteId,
          monto: r.monto,
          moneda: r.moneda,
          montoConvertido: montoFinalConvertido,
          tasaConversion: tasaFinalConversion,
          cuentaId: cuenta.id,
          subcuentaId: r.subcuentaId,
          afectaCuentaPrincipal: r.afectaCuentaPrincipal,
          fecha: new Date(),
          userId: r.userId,
          estado: 'exitoso',
          nombreRecurrente: r.nombre,
          plataforma: r.plataforma,
        });

        // Registrar en historial de cuenta
        await this.cuentaHistorialService.registrarMovimiento({
          cuentaId: cuenta.id,
          userId: r.userId,
          tipo: 'recurrente',
          descripcion: `Cargo recurrente: ${r.nombre} (${r.plataforma.nombre})`,
          monto: -montoFinalConvertido,
          fecha: new Date().toISOString(),
          conceptoId: undefined,
          subcuentaId: r.subcuentaId,
          metadata: {
            recurrenteId: r.recurrenteId,
            monedaOrigen: r.moneda,
            montoOriginal: r.monto,
            tasaConversion,
            plataforma: r.plataforma.nombre,
            afectaCuentaPrincipal: r.afectaCuentaPrincipal,
            afectaSubcuenta: r.afectaSubcuenta,
          },
        });

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
}