import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Recurrente, RecurrenteDocument } from './schemas/recurrente.schema';
import { CrearRecurrenteDto } from './dto/crear-recurrente.dto';
import { EditarRecurrenteDto } from './dto/editar-recurrente.dto';
import { HistorialRecurrente, HistorialRecurrenteDocument } from './schemas/historial-recurrente.schema';
import { generateUniqueId } from 'src/utils/generate-id';
import { NotificacionesService } from '../notificaciones/notificaciones.service';

@Injectable()
export class RecurrentesService {
  constructor(
    @InjectModel(Recurrente.name) private readonly recurrenteModel: Model<RecurrenteDocument>,
    @InjectModel(HistorialRecurrente.name) private readonly historialModel: Model<HistorialRecurrenteDocument>,
    private readonly notificacionesService: NotificacionesService,
  ) {}

  // Crear recurrente
  async crear(dto: CrearRecurrenteDto, userId: string): Promise<Recurrente> {
    const recurrenteId = await generateUniqueId(this.recurrenteModel, 'recurrenteId');

    const nuevo = new this.recurrenteModel({
      ...dto,
      recurrenteId,
      userId,
      proximaEjecucion: this.calcularProximaFecha(new Date(), dto.frecuenciaDias),
    });

    return await nuevo.save();
  }

  // Listar todos los recurrentes de un usuario
  async listar(userId: string, page = 1, limit = 10, search = '') {
    const skip = (page - 1) * limit;
  
    const filtroBase: any = {
      userId,
      ...(search && { nombre: { $regex: search, $options: 'i' } }),
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

  // Obtener uno por ID
  async obtenerPorId(recurrenteId: string): Promise<Recurrente> {
    const encontrado = await this.recurrenteModel.findOne({ recurrenteId });
    if (!encontrado) throw new NotFoundException('Recurrente no encontrado');
    return encontrado;
  }

  // Editar
  async editar(recurrenteId: string, dto: EditarRecurrenteDto): Promise<Recurrente> {
    const actualizado = await this.recurrenteModel.findOneAndUpdate(
      { recurrenteId },
      {
        ...dto,
        ...(dto.frecuenciaDias && {
          proximaEjecucion: this.calcularProximaFecha(new Date(), dto.frecuenciaDias),
        }),
      },
      { new: true },
    );

    if (!actualizado) throw new NotFoundException('Recurrente no encontrado para editar');
    return actualizado;
  }

  // Eliminar
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

  // Calcular próxima ejecución
  calcularProximaFecha(fecha: Date, dias: number): Date {
    const nueva = new Date(fecha);
    nueva.setDate(nueva.getDate() + dias);

    const dia = nueva.getDate();
    const mes = nueva.getMonth();
    const anio = nueva.getFullYear();

    const ultimoDiaMes = new Date(anio, mes + 1, 0).getDate();

    if (dia > ultimoDiaMes) {
      nueva.setDate(ultimoDiaMes);
    }

    return nueva;
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

  // Ejecutar los recurrentes del día y registrar historial
  async ejecutarRecurrentesDelDia(): Promise<number> {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const mañana = new Date(hoy);
    mañana.setDate(hoy.getDate() + 1);

    const recurrentes = await this.recurrenteModel.find({
      proximaEjecucion: { $gte: hoy, $lt: mañana },
    });

    for (const r of recurrentes) {
      await this.historialModel.create({
        recurrenteId: r.recurrenteId,
        monto: r.monto,
        cuentaId: r.cuentaId,
        subcuentaId: r.subcuentaId,
        afectaCuentaPrincipal: r.afectaCuentaPrincipal,
        fecha: new Date(),
        userId: r.userId,
      });

      r.proximaEjecucion = this.calcularProximaFecha(new Date(), r.frecuenciaDias);
      await r.save();
    }

    return recurrentes.length;
  }
}