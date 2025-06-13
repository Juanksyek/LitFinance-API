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
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
import { generateUniqueId } from '../utils/generate-id';

@Injectable()
export class SubcuentaService {
  constructor(
    @InjectModel(Subcuenta.name) private subcuentaModel: Model<SubcuentaDocument>,
    @InjectCuentaModel(Cuenta.name) private cuentaModel: Model<Cuenta>,
    private readonly monedaService: MonedaService,
    @InjectModel(SubcuentaHistorial.name) private historialModel: Model<SubcuentaHistorialDocument>,
    private readonly cuentaHistorialService: CuentaHistorialService
  ) {}

  async crear(dto: CreateSubcuentaDto, userId: string) {
  
    const {
      cuentaPrincipalId,
      tipoHistorialCuenta,
      descripcionHistorialCuenta,
      userId: _omitUserId,
      ...restoDto
    } = dto;
  
    const subCuentaId = await generateUniqueId(this.subcuentaModel, 'subCuentaId');
  
    const payload = {
      ...restoDto,
      userId,
      subCuentaId,
      cuentaId: cuentaPrincipalId,
    };
  
    const subcuenta = new this.subcuentaModel(payload);
    subcuenta.set('subsubCuentaId', await generateUniqueId(this.subcuentaModel));
  
    const creada = await subcuenta.save();
  
    // Afectar cuenta principal solo si aplica
    if (dto.afectaCuenta && cuentaPrincipalId) {
      const cuenta = await this.cuentaModel.findOne({ id: cuentaPrincipalId, userId });
      if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');
    
      let cantidadAjustada = dto.cantidad;
    
      if (dto.moneda && dto.moneda !== cuenta.moneda) {
        const conversion = await this.monedaService.obtenerTasaCambio(dto.moneda, cuenta.moneda);
        cantidadAjustada = dto.cantidad * conversion.tasa;
      }
    
      await this.cuentaModel.findOneAndUpdate(
        { id: cuentaPrincipalId, userId },
        { $inc: { cantidad: cantidadAjustada } },
      );
    
      const tipo = dto.tipoHistorialCuenta || 'ajuste_subcuenta';
      const descripcion = dto.descripcionHistorialCuenta || 'Subcuenta creada con afectación';
    
      await this.cuentaHistorialService.registrarMovimiento({
        userId,
        cuentaId: cuentaPrincipalId,
        monto: cantidadAjustada,
        tipo,
        descripcion,
        fecha: new Date().toISOString(),
        subcuentaId: subCuentaId,
      });
    }


    // Historial de subcuenta
    await this.historialModel.create({
      subcuentaId: creada._id,
      userId,
      tipo: 'creacion',
      descripcion: 'Subcuenta creada exitosamente',
      datos: { ...dto, cuentaPrincipalId, subCuentaId },
    });
  
    return {
      ...creada.toObject(),
      subCuentaId,
    };
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

  async buscarPorSubCuentaId(subCuentaId: string) {
    const resultado = await this.subcuentaModel.findOne({ subCuentaId }).lean();
    if (!resultado) {
      throw new NotFoundException(`Subcuenta no encontrada`);
    }
    return resultado;
  }

  async actualizar(id: string, dto: UpdateSubcuentaDto) {
    const antes = await this.subcuentaModel.findOne({ subCuentaId: id });
    const actualizado = await this.subcuentaModel.findOneAndUpdate(
      { subCuentaId: id },
      dto,
      { new: true }
    );
  
    if (actualizado && antes) {
      const cambios: Record<string, { antes: any; despues: any }> = {};
  
      for (const key of Object.keys(dto)) {
        const nuevoValor = dto[key];
        const valorAnterior = antes[key];
  
        if (nuevoValor !== undefined && nuevoValor !== valorAnterior) {
          cambios[key] = {
            antes: valorAnterior,
            despues: actualizado[key],
          };
        }
      }
  
      await this.historialModel.create({
        subcuentaId: actualizado.subCuentaId,
        userId: actualizado.userId,
        tipo: 'modificacion',
        descripcion: 'Subcuenta modificada exitosamente',
        datos: cambios,
      });
    }
  
    return actualizado;
  }

  async eliminar(id: string, userId: string) {
    const sub = await this.subcuentaModel.findOne({ subCuentaId: id });
    if (!sub || sub.userId !== userId) throw new NotFoundException('Subcuenta no encontrada');
  
    if (sub.afectaCuenta && sub.cuentaId) {
      const cuenta = await this.cuentaModel.findOne({ _id: sub.cuentaId, userId });
      if (cuenta) {
        let cantidadAjustada = sub.cantidad;
    
        if (sub.moneda && cuenta.moneda && sub.moneda !== cuenta.moneda) {
          const conversion = await this.monedaService.obtenerTasaCambio(sub.moneda, cuenta.moneda);
          cantidadAjustada = sub.cantidad * conversion.tasa;
        }
    
        await this.cuentaModel.findOneAndUpdate(
          { _id: sub.cuentaId, userId },
          { $inc: { cantidad: -cantidadAjustada } },
        );
      }
    }
  
    await sub.deleteOne();
  
    await this.historialModel.create({
      subcuentaId: sub.subCuentaId,
      userId,
      tipo: 'eliminacion',
      descripcion: 'Subcuenta eliminada exitosamente',
      datos: { id },
    });
  
    return { message: 'Subcuenta eliminada' };
  }

  async obtenerHistorial(
    subcuentaId: string | null,
    userId: string,
    tipo?: string,
    desde?: string,
    hasta?: string,
  ) {
    const query: any = { userId };
    if (subcuentaId) query.subcuentaId = subcuentaId;
  
    if (tipo) query.tipo = tipo;
  
    if (desde || hasta) {
      query.createdAt = {};
      if (desde) query.createdAt.$gte = new Date(desde);
      if (hasta) query.createdAt.$lte = new Date(hasta);
    }
  
    return this.historialModel.find(query).sort({ createdAt: -1 });
  }

  async desactivar(id: string, userId: string) {
    const updated = await this.subcuentaModel.findOneAndUpdate(
      { subCuentaId: id, userId },
      { $set: { activa: false } },
      { new: true }
    );
  
    if (!updated) throw new NotFoundException('Subcuenta no encontrada');
  
    await this.historialModel.create({
      subcuentaId: updated.subCuentaId,
      userId,
      tipo: 'desactivacion',
      descripcion: 'Subcuenta desactivada',
      datos: { activa: false },
    });
  
    return updated;
  }

  async activar(id: string, userId: string) {
    const updated = await this.subcuentaModel.findOneAndUpdate(
      { subCuentaId: id, userId },
      { $set: { activa: true } },
      { new: true }
    );
  
    if (!updated) throw new NotFoundException('Subcuenta no encontrada');
  
    await this.historialModel.create({
      subcuentaId: updated.subCuentaId,
      userId,
      tipo: 'activacion',
      descripcion: 'Subcuenta reactivada',
      datos: { activa: true },
    });
  
    return updated;
  }

  async calcularParticipacion(userId: string) {
    const subcuentas = await this.subcuentaModel.find({
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