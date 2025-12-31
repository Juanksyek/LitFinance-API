import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
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
import { ConversionService } from '../utils/services/conversion.service';
import { UserService } from '../user/user.service';

@Injectable()
export class SubcuentaService {
  constructor(
    @InjectModel(Subcuenta.name) private subcuentaModel: Model<SubcuentaDocument>,
    @InjectCuentaModel(Cuenta.name) private cuentaModel: Model<Cuenta>,
    private readonly monedaService: MonedaService,
    @InjectModel(SubcuentaHistorial.name) private historialModel: Model<SubcuentaHistorialDocument>,
    private readonly cuentaHistorialService: CuentaHistorialService,
    private readonly conversionService: ConversionService,
    private readonly userService: UserService,
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
      origenSaldo: dto.usarSaldoCuentaPrincipal ? 'cuenta_principal' : 'nuevo',
    };
  
    const subcuenta = new this.subcuentaModel(payload);
    subcuenta.set('subsubCuentaId', await generateUniqueId(this.subcuentaModel));
  
    // Si afecta cuenta y existe cuenta principal, calcular conversión
    if (dto.afectaCuenta && cuentaPrincipalId) {
      const cuenta = await this.cuentaModel.findOne({ id: cuentaPrincipalId, userId });
      if (!cuenta) throw new NotFoundException('Cuenta principal no encontrada');

      let cantidadAjustada = dto.cantidad;

      if (dto.moneda && dto.moneda !== cuenta.moneda) {
        const conversion = await this.conversionService.convertir(
          dto.cantidad,
          dto.moneda,
          cuenta.moneda,
        );
        cantidadAjustada = conversion.montoConvertido;

        // Guardar metadata de conversión en la subcuenta
        subcuenta.montoConvertido = conversion.montoConvertido;
        subcuenta.tasaConversion = conversion.tasaConversion;
        subcuenta.fechaConversion = conversion.fechaConversion;
      }

      const tipo = dto.tipoHistorialCuenta || 'ajuste_subcuenta';

      // Modo "apartado": valida que exista saldo suficiente, pero NO modifica el saldo de la cuenta
      // (evita inflar el saldo total al crear subcuentas con saldo ya existente)
      if (dto.usarSaldoCuentaPrincipal) {
        if (cuenta.cantidad < cantidadAjustada) {
          throw new BadRequestException(
            `Saldo insuficiente en la cuenta principal para apartar ${cantidadAjustada}. Disponible: ${cuenta.cantidad}`,
          );
        }

        const descripcion =
          dto.descripcionHistorialCuenta ||
          `Subcuenta creada como apartado (monto: ${cantidadAjustada} ${cuenta.moneda})`;

        await this.cuentaHistorialService.registrarMovimiento({
          userId,
          cuentaId: cuentaPrincipalId,
          monto: 0,
          tipo,
          descripcion,
          fecha: new Date().toISOString(),
          subcuentaId: subCuentaId,
        });
      } else {
        // Modo "nuevo saldo": conserva comportamiento actual (la creación suma al saldo de la cuenta)
        await this.cuentaModel.findOneAndUpdate(
          { id: cuentaPrincipalId, userId },
          { $inc: { cantidad: cantidadAjustada } },
        );

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
    }

    const creada = await subcuenta.save();

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

  async listar( userId: string, subCuentaId?: string, search = '', page = 1, limit = 10, incluirInactivas = true ) {
    const query: any = { userId };
  
    if (!incluirInactivas) {
      query.activa = true;
    }
  
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
    if (!antes) throw new NotFoundException('Subcuenta no encontrada');
  
    let cambios: Record<string, { antes: any; despues: any }> = {};
  
    // Si cambia la moneda, recalcular cantidad en la nueva moneda
    if (dto.moneda && dto.moneda !== antes.moneda) {
      const conversion = await this.conversionService.convertir(
        antes.cantidad,
        antes.moneda,
        dto.moneda,
      );
      const nuevaCantidad = conversion.montoConvertido;
  
      dto.cantidad = nuevaCantidad;
  
      cambios['moneda'] = { antes: antes.moneda, despues: dto.moneda };
      cambios['cantidad'] = { antes: antes.cantidad, despues: nuevaCantidad };
    }
  
    const actualizado = await this.subcuentaModel.findOneAndUpdate(
      { subCuentaId: id },
      dto,
      { new: true }
    );
  
    if (actualizado) {
      for (const key of Object.keys(dto)) {
        const nuevoValor = dto[key];
        const valorAnterior = antes[key];
  
        if (
          nuevoValor !== undefined &&
          JSON.stringify(nuevoValor) !== JSON.stringify(valorAnterior) &&
          !cambios[key]
        ) {
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
    try {
  
      const sub = await this.subcuentaModel.findOne({ subCuentaId: id });
      if (!sub || sub.userId !== userId) {
        throw new NotFoundException('Subcuenta no encontrada o no pertenece al usuario');
      }      
      if (sub.afectaCuenta && sub.cuentaId && sub.origenSaldo !== 'cuenta_principal') {
        const cuenta = await this.cuentaModel.findOne({ id: sub.cuentaId, userId });
  
        if (cuenta) {
          let cantidadAjustada = sub.cantidad;
  
          if (sub.moneda && cuenta.moneda && sub.moneda !== cuenta.moneda) {
            const conversion = await this.conversionService.convertir(
              sub.cantidad,
              sub.moneda,
              cuenta.moneda,
            );
            cantidadAjustada = conversion.montoConvertido;
          }
  
          const resultado = await this.cuentaModel.findOneAndUpdate(
            { id: sub.cuentaId, userId },
            { $inc: { cantidad: -cantidadAjustada } },
          );
    
          await this.cuentaHistorialService.registrarMovimiento({
            userId,
            cuentaId: sub.cuentaId,
            monto: -cantidadAjustada,
            tipo: 'ajuste_subcuenta',
            descripcion: `Ajuste por eliminación de subcuenta: ${sub.nombre}`,
            fecha: new Date().toISOString(),
            subcuentaId: sub.subCuentaId,
          });
        } else {  
          await this.cuentaHistorialService.registrarMovimiento({
            userId,
            cuentaId: sub.cuentaId,
            monto: 0,
            tipo: 'ajuste_subcuenta',
            descripcion: `Eliminación de subcuenta: ${sub.nombre}`,
            fecha: new Date().toISOString(),
            subcuentaId: sub.subCuentaId,
          });
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
  
    } catch (err) {
      throw new InternalServerErrorException('Error interno al eliminar subcuenta');
    }
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