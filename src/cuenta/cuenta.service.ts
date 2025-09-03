import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cuenta } from './schemas/cuenta.schema/cuenta.schema';
import { UpdateCuentaDto } from './dto/update-cuenta.dto/update-cuenta.dto';
import { MonedaService } from '../moneda/moneda.service';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
import { CuentaDocument } from './schemas/cuenta.schema/cuenta.schema';
import { CurrencyConversionService } from '../user/services/currency-conversion.service';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';

@Injectable()
export class CuentaService {
  private readonly logger = new Logger(CuentaService.name);

  constructor(
    @InjectModel(Cuenta.name) private cuentaModel: Model<Cuenta>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
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

  async obtenerVistaPrevia(userId: string, nuevaMoneda: string) {
    return this.currencyConversionService.obtenerResumenCambioMoneda(userId, nuevaMoneda);
  }

  /**
   * Verifica y corrige la sincronización entre monedaPreferencia del usuario y moneda de cuenta principal
   */
  async verificarSincronizacionMoneda(userId: string): Promise<void> {
    const usuario = await this.userModel.findOne({ id: userId });
    const cuenta = await this.cuentaModel.findOne({ userId, isPrincipal: true });

    if (usuario && cuenta && usuario.monedaPreferencia !== cuenta.moneda) {
      this.logger.warn(`Inconsistencia detectada: Usuario ${userId} tiene monedaPreferencia=${usuario.monedaPreferencia} pero cuenta principal tiene moneda=${cuenta.moneda}`);
      
      await this.userModel.findOneAndUpdate(
        { id: userId },
        { 
          $set: { 
            monedaPreferencia: cuenta.moneda,
            updatedAt: new Date()
          }
        }
      );
      
      this.logger.log(`Sincronización completada: Usuario ${userId} monedaPreferencia actualizada a ${cuenta.moneda}`);
    }
  }

  async editarCuentaPrincipal(userId: string, updateData: UpdateCuentaDto): Promise<any> {
    const cuenta = await this.cuentaModel.findOne({ userId, isPrincipal: true });

    if (!cuenta) {
      throw new NotFoundException('Cuenta principal no encontrada');
    }

    if (updateData.moneda && updateData.moneda !== cuenta.moneda) {
      const todas = await this.monedaService.listarMonedas();
      const nuevaMoneda = todas.find((m) => m.codigo === updateData.moneda);

      if (!nuevaMoneda) {
        throw new BadRequestException('La moneda seleccionada no es válida');
      }

      const resultado = await this.currencyConversionService.cambiarMonedaBaseUsuario(userId, updateData.moneda);
      
      const otrosUpdateData = { ...updateData };
      delete otrosUpdateData.moneda;
      delete otrosUpdateData.simbolo; // Se actualiza automáticamente con la moneda
      delete otrosUpdateData.cantidad; // Se convierte automáticamente
      
      if (Object.keys(otrosUpdateData).length > 0) {
        await this.cuentaModel.findOneAndUpdate(
          { userId, isPrincipal: true },
          { $set: otrosUpdateData },
          { new: true }
        );
      }
      
      const cuentaActualizada = await this.cuentaModel.findOne({ userId, isPrincipal: true });
      
      await this.verificarSincronizacionMoneda(userId);
      
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
