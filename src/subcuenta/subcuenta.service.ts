import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subcuenta, SubcuentaDocument } from './schemas/subcuenta.schema/subcuenta.schema';
import { CreateSubcuentaDto } from './dto/create-subcuenta.dto/create-subcuenta.dto';
import { UpdateSubcuentaDto } from './dto/update-subcuenta.dto/update-subcuenta.dto';
import { Cuenta } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { InjectModel as InjectCuentaModel } from '@nestjs/mongoose';
import { MonedaService } from '../moneda/moneda.service';
import { SubcuentaHistorial, SubcuentaHistorialDocument } from './schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import * as mongoose from 'mongoose';

const generateUniqueId = async (model: Model<any>, field: string = 'subsubCuentaId'): Promise<string> => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id: string;
  let exists: any;

  do {
    id = '';
    for (let i = 0; i < 7; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const query: any = {};
    query[field] = id;
    exists = await model.findOne(query);
  } while (exists);

  return id;
};

@Injectable()
export class SubcuentaService {
  constructor(
    @InjectModel(Subcuenta.name) private subcuentaModel: Model<SubcuentaDocument>,
    @InjectCuentaModel(Cuenta.name) private cuentaModel: Model<Cuenta>,
    private readonly monedaService: MonedaService,
    @InjectModel(SubcuentaHistorial.name) private historialModel: Model<SubcuentaHistorialDocument>,
  ) {}

  async crear(dto: CreateSubcuentaDto, userId: string) {
    console.log('🧾 [crear] userId recibido:', userId);
    console.log('📦 [crear] dto recibido:', dto);

    const { cuentaPrincipalId, userId: _omitUserId, ...restoDto } = dto;

    const payload = {
      ...restoDto,
      userId,
    };

    console.log('🧱 [crear] Payload final para Mongoose:', payload);

    const subcuenta = new this.subcuentaModel(payload);
    subcuenta.set('subsubCuentaId', await generateUniqueId(this.subcuentaModel));

    const creada = await subcuenta.save();

    if (dto.afectaCuenta && cuentaPrincipalId) {
      if (!mongoose.Types.ObjectId.isValid(cuentaPrincipalId)) {
        throw new NotFoundException('El ID de cuenta no es válido');
      }

      const cuenta = await this.cuentaModel.findOne({ _id: cuentaPrincipalId, userId });
      if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');

      let cantidadAjustada = dto.cantidad;

      if (dto.moneda && dto.moneda !== cuenta.moneda) {
        const conversion = await this.monedaService.obtenerTasaCambio(dto.moneda, cuenta.moneda);
        cantidadAjustada = dto.cantidad * conversion.tasa;
      }

      await this.cuentaModel.findOneAndUpdate(
        { _id: cuentaPrincipalId, userId },
        { $inc: { cantidad: cantidadAjustada } },
      );
    }

    await this.historialModel.create({
      subcuentaId: creada._id,
      userId,
      tipo: 'creacion',
      descripcion: 'Subcuenta creada exitosamente',
      datos: { ...dto, cuentaPrincipalId },
    });

    return creada;
  }

  async listar(userId: string, subCuentaId?: string, search = '', page = 1, limit = 10) {
    const query: any = { userId, activa: true };
    if (subCuentaId) query.subCuentaId = subCuentaId;
    if (search) query.nombre = { $regex: search, $options: 'i' };

    return this.subcuentaModel
      .find(query)
      .skip((page - 1) * limit)
      .limit(limit);
  }

  async actualizar(id: string, dto: UpdateSubcuentaDto) {
    const actualizado = await this.subcuentaModel.findByIdAndUpdate(id, dto, { new: true });

    if (actualizado) {
      await this.historialModel.create({
        subsubCuentaId: actualizado._id,
        userId: actualizado.userId,
        tipo: 'modificacion',
        descripcion: 'Subcuenta modificada exitosamente',
        datos: { ...dto },
      });
    }

    return actualizado;
  }

  async eliminar(id: string, userId: string) {
    const sub = await this.subcuentaModel.findById(id);
    if (!sub || sub.userId !== userId) throw new NotFoundException('Subcuenta no encontrada');

    if (sub.afectaCuenta && sub.subCuentaId) {
      const cuenta = await this.cuentaModel.findOne({ _id: sub.subCuentaId, userId });
      let cantidadAjustada = sub.cantidad;

      if (sub.moneda && cuenta?.moneda && sub.moneda !== cuenta.moneda) {
        const conversion = await this.monedaService.obtenerTasaCambio(sub.moneda, cuenta.moneda);
        cantidadAjustada = sub.cantidad * conversion.tasa;
      }

      await this.cuentaModel.findOneAndUpdate(
        { _id: sub.subCuentaId, userId },
        { $inc: { cantidad: -cantidadAjustada } },
      );
    }

    await sub.deleteOne();

    await this.historialModel.create({
      subsubCuentaId: sub._id,
      userId,
      tipo: 'eliminacion',
      descripcion: 'Subcuenta eliminada exitosamente',
      datos: { id },
    });

    return { message: 'Subcuenta eliminada' };
  }

  async obtenerHistorial(
    subsubCuentaId: string,
    userId: string,
    tipo?: string,
    desde?: string,
    hasta?: string,
  ) {
    const query: any = {
      subsubCuentaId,
      userId,
    };

    if (tipo) {
      query.tipo = tipo;
    }

    if (desde || hasta) {
      query.createdAt = {};
      if (desde) {
        query.createdAt.$gte = new Date(desde);
      }
      if (hasta) {
        query.createdAt.$lte = new Date(hasta);
      }
    }

    return this.historialModel.find(query).sort({ createdAt: -1 });
  }

  async desactivar(id: string, userId: string) {
    const updated = await this.subcuentaModel.findOneAndUpdate(
      { _id: id, userId },
      { $set: { activa: false } },
      { new: true }
    );

    if (!updated) throw new NotFoundException('Subcuenta no encontrada');

    await this.historialModel.create({
      subsubCuentaId: updated._id,
      userId,
      tipo: 'desactivacion',
      descripcion: 'Subcuenta desactivada',
      datos: { id },
    });

    return updated;
  }

  async activar(id: string, userId: string) {
    const updated = await this.subcuentaModel.findOneAndUpdate(
      { _id: id, userId },
      { $set: { activa: true } },
      { new: true }
    );

    if (!updated) throw new NotFoundException('Subcuenta no encontrada');

    await this.historialModel.create({
      subsubCuentaId: updated._id,
      userId,
      tipo: 'activacion',
      descripcion: 'Subcuenta reactivada',
      datos: { id },
    });

    return updated;
  }

  async calcularParticipacion(userId: string, subCuentaId: string) {
    const cuenta = await this.cuentaModel.findOne({ _id: subCuentaId, userId });
    if (!cuenta) {
      throw new NotFoundException('Cuenta principal no encontrada');
    }

    const subcuentas = await this.subcuentaModel.find({
      subCuentaId,
      userId,
      activa: true,
    });

    const total = subcuentas.reduce((sum, sub) => sum + sub.cantidad, 0);

    return subcuentas.map((sub) => ({
      subsubCuentaId: sub._id,
      nombre: sub.nombre,
      cantidad: sub.cantidad,
      porcentaje: total > 0 ? (sub.cantidad / total) * 100 : 0,
    }));
  }
}