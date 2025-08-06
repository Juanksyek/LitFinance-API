import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cuenta } from './schemas/cuenta.schema/cuenta.schema';
import { UpdateCuentaDto } from './dto/update-cuenta.dto/update-cuenta.dto';
import { MonedaService } from '../moneda/moneda.service';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
import { CuentaDocument } from './schemas/cuenta.schema/cuenta.schema';
import { CurrencyConversionService } from '../user/services/currency-conversion.service';

@Injectable()
export class CuentaService {
  constructor(
    @InjectModel(Cuenta.name) private cuentaModel: Model<Cuenta>,
    private readonly monedaService: MonedaService,
    private readonly cuentaHistorialService: CuentaHistorialService,
    @Inject(forwardRef(() => CurrencyConversionService))
    private readonly currencyConversionService: CurrencyConversionService,
  ) { }

  async obtenerCuentaPrincipal(userId: string): Promise<CuentaDocument> {
    const cuenta = await this.cuentaModel.findOne({ userId, isPrincipal: true });
    if (!cuenta) {
      throw new NotFoundException('Cuenta principal no encontrada');
    }
    return cuenta;
  }

  /**
   * Obtiene una vista previa de lo que se afectará con el cambio de moneda
   */
  async obtenerVistaPrevia(userId: string, nuevaMoneda: string) {
    return this.currencyConversionService.obtenerResumenCambioMoneda(userId, nuevaMoneda);
  }

  async editarCuentaPrincipal(userId: string, updateData: UpdateCuentaDto): Promise<any> {
    const cuenta = await this.cuentaModel.findOne({ userId, isPrincipal: true });

    if (!cuenta) {
      throw new NotFoundException('Cuenta principal no encontrada');
    }

    // Si se cambia la moneda, utilizamos el servicio completo de conversión
    if (updateData.moneda && updateData.moneda !== cuenta.moneda) {
      // Validar que la nueva moneda existe
      const todas = await this.monedaService.listarMonedas();
      const nuevaMoneda = todas.find((m) => m.codigo === updateData.moneda);

      if (!nuevaMoneda) {
        throw new BadRequestException('La moneda seleccionada no es válida');
      }

      // Usar el servicio de conversión completa que maneja todo el historial
      const resultado = await this.currencyConversionService.cambiarMonedaBaseUsuario(userId, updateData.moneda);
      
      // Obtener la cuenta actualizada después de la conversión
      const cuentaActualizada = await this.cuentaModel.findOne({ userId, isPrincipal: true });
      
      return {
        message: resultado.message,
        cuenta: cuentaActualizada,
        conversion: resultado
      };
    }

    // Si no se cambia la moneda, actualización normal
    const cuentaActualizada = await this.cuentaModel.findOneAndUpdate(
      { userId, isPrincipal: true },
      { $set: updateData },
      { new: true }
    );

    if (!cuentaActualizada) {
      throw new NotFoundException('No se pudo actualizar la cuenta principal');
    }
    
    return {
      message: 'Cuenta principal actualizada exitosamente',
      cuenta: cuentaActualizada
    };
  }
}
