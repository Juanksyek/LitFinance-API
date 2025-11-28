import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Recurrente, RecurrenteDocument } from './schemas/recurrente.schema';
import { CrearRecurrenteDto } from './dto/crear-recurrente.dto';
import { EditarRecurrenteDto } from './dto/editar-recurrente.dto';
import { HistorialRecurrente, HistorialRecurrenteDocument } from './schemas/historial-recurrente.schema';
import { generateUniqueId } from 'src/utils/generate-id';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { CuentaService } from '../cuenta/cuenta.service';
import { CuentaDocument } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { MonedaService } from '../moneda/moneda.service';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
import { ConversionService } from '../utils/services/conversion.service';
import { UserService } from '../user/user.service';

@Injectable()
export class RecurrentesService {
  constructor(
    @InjectModel(Recurrente.name) private readonly recurrenteModel: Model<RecurrenteDocument>,
    @InjectModel(HistorialRecurrente.name) private readonly historialModel: Model<HistorialRecurrenteDocument>,
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

    // NO convertimos en creación, solo registramos en historial para tracking
    if (dto.afectaCuentaPrincipal) {
      await this.cuentaHistorialService.registrarMovimiento({
        cuentaId: (cuenta._id as string).toString(),
        userId,
        tipo: 'recurrente',
        descripcion: `Se registró el recurrente "${dto.nombre}" por ${dto.monto} ${dto.moneda} (se convertirá en cada ejecución)`,
        monto: 0, // No afectamos aún la cuenta
        fecha: new Date().toISOString(),
        conceptoId: undefined,
        subcuentaId: undefined,
        metadata: {
          monedaOrigen: dto.moneda,
          montoOriginal: dto.monto,
          nota: 'Conversión pendiente hasta ejecución',
        },
      });
    }

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

    if (!actualizado) throw new NotFoundException('Recurrente no encontrado para editar');
    return actualizado;
  }

  async eliminar(recurrenteId: string): Promise<{ eliminado: boolean; mensaje: string }> {
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

  async ejecutarRecurrentesDelDia(): Promise<number> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const mañana = new Date(hoy);
    mañana.setDate(hoy.getDate() + 1);

    const recurrentes = await this.recurrenteModel.find({
      proximaEjecucion: { $gte: hoy, $lt: mañana },
      pausado: { $ne: true },
    });

    for (const r of recurrentes) {
      // Obtener monedaPrincipal del usuario
      const user = await this.userService.getProfile(r.userId);
      const monedaPrincipal = user.monedaPrincipal || 'MXN';

      let montoConvertido = r.monto;
      let tasaConversion = 1;

      // Convertir usando tasas ACTUALES en cada ejecución
      if (r.moneda !== monedaPrincipal) {
        const conversion = await this.conversionService.convertir(
          r.monto,
          r.moneda,
          monedaPrincipal,
        );
        montoConvertido = conversion.montoConvertido;
        tasaConversion = conversion.tasaConversion;

        // Guardar conversión en el documento recurrente para referencia
        r.montoConvertido = montoConvertido;
        r.tasaConversion = tasaConversion;
        r.fechaConversion = conversion.fechaConversion;
      }

      await this.historialModel.create({
        recurrenteId: r.recurrenteId,
        monto: r.monto,
        cuentaId: r.cuentaId,
        subcuentaId: r.subcuentaId,
        afectaCuentaPrincipal: r.afectaCuentaPrincipal,
        fecha: new Date(),
        userId: r.userId,
        observacion: r.moneda !== monedaPrincipal 
          ? `Convertido de ${r.monto} ${r.moneda} a ${montoConvertido} ${monedaPrincipal} (tasa: ${tasaConversion})`
          : undefined,
      });

      if (r.frecuenciaTipo && r.frecuenciaValor) {
        r.proximaEjecucion = this.calcularProximaFechaPersonalizada(new Date(), r.frecuenciaTipo, r.frecuenciaValor);
      }
      
      await r.save();
    }

    return recurrentes.length;
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
      monto: 0,
      cuentaId: recurrente.cuentaId,
      subcuentaId: recurrente.subcuentaId,
      afectaCuentaPrincipal: recurrente.afectaCuentaPrincipal,
      fecha: new Date(),
      userId: recurrente.userId,
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
      monto: 0,
      cuentaId: recurrente.cuentaId,
      subcuentaId: recurrente.subcuentaId,
      afectaCuentaPrincipal: recurrente.afectaCuentaPrincipal,
      fecha: new Date(),
      userId: recurrente.userId,
      observacion: '▶️ Recurrente reanudado por el usuario',
    });
  
    return { mensaje: `Recurrente \"${recurrente.nombre}\" reanudado correctamente.` };
  }
}