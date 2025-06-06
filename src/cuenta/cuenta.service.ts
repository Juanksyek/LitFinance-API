import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cuenta } from './schemas/cuenta.schema/cuenta.schema';
import { UpdateCuentaDto } from './dto/update-cuenta.dto/update-cuenta.dto';
import { MonedaService } from '../moneda/moneda.service';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';

@Injectable()
export class CuentaService {
  constructor(
    @InjectModel(Cuenta.name) private cuentaModel: Model<Cuenta>,
    private readonly monedaService: MonedaService,
    private readonly cuentaHistorialService: CuentaHistorialService,
  ) { }

  async obtenerCuentaPrincipal(userId: string): Promise<Cuenta> {
    const cuenta = await this.cuentaModel.findOne({ userId, isPrincipal: true });
    if (!cuenta) {
      throw new NotFoundException('Cuenta principal no encontrada');
    }
    return cuenta;
  }

  async editarCuentaPrincipal(userId: string, updateData: UpdateCuentaDto): Promise<Cuenta> {
    const cuenta = await this.cuentaModel.findOne({ userId, isPrincipal: true });

    if (!cuenta) {
      throw new NotFoundException('Cuenta principal no encontrada');
    }

    // Si se cambia la moneda, hacemos conversión y validación
    if (
      updateData.moneda &&
      updateData.moneda !== cuenta.moneda &&
      typeof cuenta.cantidad === 'number'
    ) {
      const todas = await this.monedaService.listarMonedas();
      const nuevaMoneda = todas.find((m) => m.codigo === updateData.moneda);

      if (!nuevaMoneda) {
        throw new BadRequestException('La moneda seleccionada no es válida');
      }

      // Obtener conversión
      const conversion = await this.monedaService.intercambiarDivisa(
        cuenta.cantidad,
        cuenta.moneda,
        updateData.moneda,
      );

      updateData.cantidad = parseFloat(conversion.montoConvertido.toFixed(2));
      updateData.simbolo = nuevaMoneda.simbolo;

      // Registrar en historial
      await this.cuentaHistorialService.registrarMovimiento({
        cuentaId: cuenta._id.toString(),
        userId,
        tipo: 'cambio_moneda',
        descripcion: `Cambio de moneda de ${cuenta.moneda} a ${updateData.moneda}`,
        monto: updateData.cantidad,
        fecha: new Date().toISOString(),
        conceptoId: undefined,
        subcuentaId: undefined,
        metadata: {
          monedaAnterior: cuenta.moneda,
          monedaNueva: updateData.moneda,
          simboloNuevo: nuevaMoneda.simbolo,
          tasaCambio: conversion.tasa,
          cantidadAnterior: cuenta.cantidad,
          cantidadNueva: updateData.cantidad,
        },
      });
    }

    const cuentaActualizada = await this.cuentaModel.findOneAndUpdate(
      { userId, isPrincipal: true },
      { $set: updateData },
      { new: true }
    );

    if (!cuentaActualizada) {
      throw new NotFoundException('No se pudo actualizar la cuenta principal');
    }
    return cuentaActualizada;
  }
}
