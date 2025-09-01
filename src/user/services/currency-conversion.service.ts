import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema/user.schema';
import { Cuenta, CuentaDocument } from '../../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Transaction, TransactionDocument } from '../../transactions/schemas/transaction.schema/transaction.schema';
import { CuentaHistorial, CuentaHistorialDocument } from '../../cuenta-historial/schemas/cuenta-historial.schema';
import { Moneda, MonedaDocument } from '../../moneda/schema/moneda.schema';
import { MonedaService } from '../../moneda/moneda.service';
import { CuentaHistorialService } from '../../cuenta-historial/cuenta-historial.service';
import { MoneyValidationService } from '../../utils/validators/money-validation.service';
import { ConversionResult, CurrencyChangePreview } from '../interfaces/currency-conversion.interfaces';

@Injectable()
export class CurrencyConversionService {
  private readonly logger = new Logger(CurrencyConversionService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    @InjectModel(CuentaHistorial.name) private readonly historialModel: Model<CuentaHistorialDocument>,
    @InjectModel(Moneda.name) private readonly monedaModel: Model<MonedaDocument>,
    private readonly monedaService: MonedaService,
    private readonly cuentaHistorialService: CuentaHistorialService,
    private readonly moneyValidationService: MoneyValidationService,
  ) {}

  /**
   * Cambia la moneda base del usuario y convierte todas las cifras históricas
   * @param userId ID del usuario
   * @param nuevaMoneda Código de la nueva moneda
   * @returns Resultado de la conversión con estadísticas
   */
  async cambiarMonedaBaseUsuario(userId: string, nuevaMoneda: string): Promise<ConversionResult> {
    this.logger.log(`Iniciando cambio de moneda base para usuario ${userId} a ${nuevaMoneda}`);

    // 1. Validaciones iniciales
    const usuario = await this.userModel.findOne({ id: userId });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const monedaDestino = await this.monedaModel.findOne({ codigo: nuevaMoneda });
    if (!monedaDestino) {
      throw new BadRequestException(`La moneda ${nuevaMoneda} no existe en el catálogo`);
    }

    const monedaActual = usuario.monedaPreferencia || 'USD';
    if (monedaActual === nuevaMoneda) {
      throw new BadRequestException('La moneda seleccionada ya es la moneda actual del usuario');
    }

    // 2. Obtener tasa de cambio
    const tasaCambio = await this.monedaService.obtenerTasaCambio(monedaActual, nuevaMoneda);
    
    // Validar tasa de cambio
    if (!tasaCambio || !tasaCambio.tasa || !Number.isFinite(tasaCambio.tasa) || tasaCambio.tasa <= 0) {
      this.logger.error(`Tasa de cambio inválida: ${JSON.stringify(tasaCambio)}`);
      throw new BadRequestException(`No se pudo obtener una tasa de cambio válida de ${monedaActual} a ${nuevaMoneda}`);
    }
    
    this.logger.log(`Tasa de cambio obtenida: 1 ${monedaActual} = ${tasaCambio.tasa} ${nuevaMoneda}`);

    const conversiones: ConversionResult['conversiones'] = [];
    let totalElementosConvertidos = 0;

    try {
      // 3. Convertir cuenta principal (solo si existe y no es subcuenta)
      const cuentaPrincipalConvertida = await this.convertirCuentaPrincipal(
        userId, 
        monedaActual, 
        nuevaMoneda, 
        tasaCambio.tasa,
        monedaDestino.simbolo
      );
      
      if (cuentaPrincipalConvertida.convertida) {
        conversiones.push({
          tipo: 'Cuenta Principal',
          elementosAfectados: 1,
          detalles: [cuentaPrincipalConvertida.detalles]
        });
        totalElementosConvertidos += 1;
      }

      // 4. Convertir todas las transacciones históricas
      const transaccionesConvertidas = await this.convertirTransacciones(
        userId, 
        monedaActual, 
        nuevaMoneda, 
        tasaCambio.tasa
      );
      
      if (transaccionesConvertidas.length > 0) {
        conversiones.push({
          tipo: 'Transacciones',
          elementosAfectados: transaccionesConvertidas.length,
          detalles: transaccionesConvertidas
        });
        totalElementosConvertidos += transaccionesConvertidas.length;
      }

      // 5. Convertir historial de cuenta
      const historialConvertido = await this.convertirHistorialCuenta(
        userId, 
        monedaActual, 
        nuevaMoneda, 
        tasaCambio.tasa
      );
      
      if (historialConvertido.length > 0) {
        conversiones.push({
          tipo: 'Historial de Cuenta',
          elementosAfectados: historialConvertido.length,
          detalles: historialConvertido
        });
        totalElementosConvertidos += historialConvertido.length;
      }

      // 6. NOTA: Los recurrentes se excluyen del cambio de moneda para mantener su moneda original
      this.logger.log('Los pagos recurrentes se mantienen en su moneda original y no se convierten');
      
      // Crear entrada en conversiones para informar que se excluyeron los recurrentes
      conversiones.push({
        tipo: 'Pagos Recurrentes (Excluidos)',
        elementosAfectados: 0,
        detalles: [{ mensaje: 'Los pagos recurrentes mantienen su moneda original por diseño' }]
      });

      // 7. Actualizar la moneda preferencia del usuario
      await this.userModel.findOneAndUpdate(
        { id: userId },
        { 
          $set: { 
            monedaPreferencia: nuevaMoneda,
            updatedAt: new Date()
          }
        }
      );

      // 8. Registrar el cambio en el historial
      await this.registrarCambioMonedaEnHistorial(
        userId, 
        monedaActual, 
        nuevaMoneda, 
        tasaCambio.tasa,
        totalElementosConvertidos
      );

      this.logger.log(`Cambio de moneda completado exitosamente. Total elementos convertidos: ${totalElementosConvertidos}`);

      return {
        message: `Moneda base cambiada exitosamente de ${monedaActual} a ${nuevaMoneda}`,
        summary: {
          monedaAnterior: monedaActual,
          monedaNueva: nuevaMoneda,
          tasaCambio: tasaCambio.tasa,
          elementosConvertidos: {
            transacciones: transaccionesConvertidas.length,
            historialCuenta: historialConvertido.length,
            recurrentes: 0, // Los recurrentes se excluyen del cambio de moneda
            cuentaPrincipal: cuentaPrincipalConvertida.convertida
          },
          totalElementos: totalElementosConvertidos
        },
        conversiones
      };

    } catch (error) {
      this.logger.error(`Error durante el cambio de moneda para usuario ${userId}:`, error);
      throw new BadRequestException(`Error al cambiar la moneda: ${error.message}`);
    }
  }

  /**
   * Convierte la cuenta principal del usuario
   */
  private async convertirCuentaPrincipal(
    userId: string, 
    monedaOrigen: string, 
    monedaDestino: string, 
    tasaCambio: number,
    simboloNuevo: string
  ): Promise<{ convertida: boolean; detalles?: any }> {
    try {
      const cuentaPrincipal = await this.cuentaModel.findOne({ 
        userId, 
        isPrincipal: true 
      });

      if (!cuentaPrincipal) {
        this.logger.warn(`No se encontró cuenta principal para usuario ${userId}`);
        return { convertida: false };
      }

      // Solo convertir si la cuenta está en la moneda anterior
      if (cuentaPrincipal.moneda !== monedaOrigen) {
        this.logger.log(`Cuenta principal ya está en moneda diferente (${cuentaPrincipal.moneda}), omitiendo conversión`);
        return { convertida: false };
      }

      const montoOriginal = cuentaPrincipal.cantidad;
      const montoConvertido = this.moneyValidationService.sanitizeAmount(montoOriginal * tasaCambio);

      // Debug logging para conversión de cuenta principal
      this.logger.debug(`Conversión cuenta principal: ${montoOriginal} ${monedaOrigen} -> ${montoConvertido} ${monedaDestino} (tasa: ${tasaCambio})`);

      // Validar el monto convertido
      const validacion = this.moneyValidationService.validateAmount(montoConvertido, 'currency_conversion');
      if (!validacion.isValid) {
        this.logger.error(`Error validación monto convertido: ${validacion.error}. Valores: original=${montoOriginal}, convertido=${montoConvertido}, tasa=${tasaCambio}`);
        throw new Error(`Monto convertido inválido para cuenta principal: ${validacion.error}`);
      }

      await this.cuentaModel.findOneAndUpdate(
        { userId, isPrincipal: true },
        {
          $set: {
            cantidad: montoConvertido,
            moneda: monedaDestino,
            simbolo: simboloNuevo,
            updatedAt: new Date()
          }
        }
      );

      // Registrar en historial de cuenta
      await this.cuentaHistorialService.registrarMovimiento({
        cuentaId: cuentaPrincipal.id,
        userId,
        tipo: 'cambio_moneda',
        descripcion: `Conversión automática: ${monedaOrigen} → ${monedaDestino}`,
        monto: montoConvertido,
        fecha: new Date().toISOString(),
        conceptoId: undefined,
        subcuentaId: undefined,
        metadata: {
          tipoConversion: 'cuenta_principal',
          monedaAnterior: monedaOrigen,
          monedaNueva: monedaDestino,
          montoAnterior: montoOriginal,
          montoNuevo: montoConvertido,
          tasaCambio,
          simboloNuevo
        }
      });

      return {
        convertida: true,
        detalles: {
          id: cuentaPrincipal.id,
          nombre: cuentaPrincipal.nombre,
          montoAnterior: montoOriginal,
          montoNuevo: montoConvertido,
          monedaAnterior: monedaOrigen,
          monedaNueva: monedaDestino
        }
      };

    } catch (error) {
      this.logger.error('Error al convertir cuenta principal:', error);
      throw error;
    }
  }

  /**
   * Convierte todas las transacciones del usuario
   */
  private async convertirTransacciones(
    userId: string, 
    monedaOrigen: string, 
    monedaDestino: string, 
    tasaCambio: number
  ): Promise<any[]> {
    try {
      // Buscar transacciones que no tengan campo moneda o que estén en la moneda anterior
      const transacciones = await this.transactionModel.find({
        userId,
        $or: [
          { moneda: { $exists: false } }, // Transacciones sin campo moneda (asumimos moneda anterior)
          { moneda: monedaOrigen }, // Transacciones en moneda anterior
          { moneda: null }, // Transacciones con moneda null
          { moneda: '' } // Transacciones con moneda vacía
        ]
      });

      if (transacciones.length === 0) {
        return [];
      }

      const transaccionesConvertidas: any[] = [];
      
      for (const transaccion of transacciones) {
        const montoOriginal = transaccion.monto;
        const montoConvertido = this.moneyValidationService.sanitizeAmount(montoOriginal * tasaCambio);

        // Debug logging para transacciones
        this.logger.debug(`Conversión transacción ${transaccion.transaccionId}: ${montoOriginal} -> ${montoConvertido} (tasa: ${tasaCambio})`);

        // Validar el monto convertido
        const validacion = this.moneyValidationService.validateAmount(montoConvertido, 'currency_conversion');
        if (!validacion.isValid) {
          this.logger.warn(`Transacción ${transaccion.transaccionId} tiene monto inválido después de conversión: ${validacion.error}. Valores: original=${montoOriginal}, convertido=${montoConvertido}, tasa=${tasaCambio}`);
          continue;
        }

        await this.transactionModel.findOneAndUpdate(
          { transaccionId: transaccion.transaccionId },
          {
            $set: {
              monto: montoConvertido,
              moneda: monedaDestino,
              updatedAt: new Date(),
              // Agregar metadata de conversión
              conversionMetadata: {
                montoOriginal,
                monedaOriginal: monedaOrigen,
                tasaCambioUsada: tasaCambio,
                fechaConversion: new Date()
              }
            }
          }
        );

        transaccionesConvertidas.push({
          id: transaccion.transaccionId,
          tipo: transaccion.tipo,
          concepto: transaccion.concepto,
          montoAnterior: montoOriginal,
          montoNuevo: montoConvertido,
          fecha: (transaccion as any).createdAt || new Date()
        });
      }

      return transaccionesConvertidas;

    } catch (error) {
      this.logger.error('Error al convertir transacciones:', error);
      throw error;
    }
  }

  /**
   * Convierte el historial de cuenta
   */
  private async convertirHistorialCuenta(
    userId: string, 
    monedaOrigen: string, 
    monedaDestino: string, 
    tasaCambio: number
  ): Promise<any[]> {
    try {
      // Buscar historial que no tenga campo moneda o que esté en la moneda anterior
      const historial = await this.historialModel.find({
        userId,
        $or: [
          { moneda: { $exists: false } },
          { moneda: monedaOrigen },
          { moneda: null },
          { moneda: '' }
        ]
      });

      if (historial.length === 0) {
        return [];
      }

      const historialConvertido: any[] = [];

      for (const registro of historial) {
        const montoOriginal = Math.abs(registro.monto); // Usar valor absoluto
        const montoConvertido = this.moneyValidationService.sanitizeAmount(montoOriginal * tasaCambio);

        // Validar el monto convertido
        const validacion = this.moneyValidationService.validateAmount(montoConvertido, 'currency_conversion');
        if (!validacion.isValid) {
          this.logger.warn(`Registro de historial ${registro.id} tiene monto inválido después de conversión: ${validacion.error}`);
          continue;
        }

        // Mantener el signo original del monto si era negativo
        const montoFinal = registro.monto < 0 ? -montoConvertido : montoConvertido;

        await this.historialModel.findOneAndUpdate(
          { id: registro.id },
          {
            $set: {
              monto: montoFinal,
              moneda: monedaDestino,
              updatedAt: new Date(),
              // Agregar metadata de conversión
              'metadata.conversion': {
                montoOriginal: registro.monto,
                monedaOriginal: monedaOrigen,
                tasaCambioUsada: tasaCambio,
                fechaConversion: new Date()
              }
            }
          }
        );

        historialConvertido.push({
          id: registro.id,
          tipo: registro.tipo,
          descripcion: registro.descripcion,
          montoAnterior: registro.monto,
          montoNuevo: montoFinal,
          fecha: registro.fecha
        });
      }

      return historialConvertido;

    } catch (error) {
      this.logger.error('Error al convertir historial de cuenta:', error);
      throw error;
    }
  }

  /**
   * Registra el cambio de moneda en el historial general
   */
  private async registrarCambioMonedaEnHistorial(
    userId: string,
    monedaAnterior: string,
    monedaNueva: string,
    tasaCambio: number,
    totalElementos: number
  ): Promise<void> {
    try {
      // Buscar la cuenta principal para el registro
      const cuentaPrincipal = await this.cuentaModel.findOne({ 
        userId, 
        isPrincipal: true 
      });

      if (!cuentaPrincipal) {
        this.logger.warn(`No se encontró cuenta principal para registrar cambio de moneda del usuario ${userId}`);
        return;
      }

      await this.cuentaHistorialService.registrarMovimiento({
        cuentaId: cuentaPrincipal.id,
        userId,
        tipo: 'cambio_moneda',
        descripcion: `Cambio de moneda base del usuario: ${monedaAnterior} → ${monedaNueva}`,
        monto: 0, // No afecta el monto, es solo informativo
        fecha: new Date().toISOString(),
        conceptoId: undefined,
        subcuentaId: undefined,
        metadata: {
          tipoConversion: 'cambio_moneda_base',
          monedaAnterior,
          monedaNueva,
          tasaCambio,
          totalElementosConvertidos: totalElementos,
          fechaConversion: new Date(),
          alcance: 'usuario_completo'
        }
      });

    } catch (error) {
      this.logger.error('Error al registrar cambio de moneda en historial:', error);
      // No lanzar error ya que el registro es secundario
    }
  }

  /**
   * Obtiene un resumen de los elementos que serían afectados por un cambio de moneda
   * (útil para mostrar al usuario antes de confirmar)
   */
  async obtenerResumenCambioMoneda(userId: string, nuevaMoneda: string): Promise<CurrencyChangePreview> {
    const usuario = await this.userModel.findOne({ id: userId });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const monedaActual = usuario.monedaPreferencia || 'USD';
    if (monedaActual === nuevaMoneda) {
      throw new BadRequestException('La moneda seleccionada ya es la moneda actual del usuario');
    }

    // Contar elementos que serían afectados
    const [cuentaPrincipal, transacciones, historial] = await Promise.all([
      this.cuentaModel.countDocuments({ userId, isPrincipal: true, moneda: monedaActual }),
      this.transactionModel.countDocuments({
        userId,
        $or: [
          { moneda: { $exists: false } },
          { moneda: monedaActual },
          { moneda: null },
          { moneda: '' }
        ]
      }),
      this.historialModel.countDocuments({
        userId,
        $or: [
          { moneda: { $exists: false } },
          { moneda: monedaActual },
          { moneda: null },
          { moneda: '' }
        ]
      })
    ]);

    // Contar recurrentes (para información, pero no se convertirán)
    let recurrentes = 0;
    try {
      const RecurrenteModel = this.userModel.db.model('Recurrente');
      recurrentes = await RecurrenteModel.countDocuments({
        userId,
        $or: [
          { moneda: monedaActual },
          { moneda: { $exists: false } },
          { moneda: null },
          { moneda: '' }
        ]
      });
    } catch (error) {
      this.logger.warn('No se pudo contar recurrentes:', error);
    }

    // Obtener tasa de cambio
    const tasaCambio = await this.monedaService.obtenerTasaCambio(monedaActual, nuevaMoneda);

    return {
      monedaActual,
      nuevaMoneda,
      tasaCambio: tasaCambio.tasa,
      elementosAfectados: {
        cuentaPrincipal: cuentaPrincipal > 0,
        transacciones,
        historialCuenta: historial,
        recurrentes: 0, // Los recurrentes se excluyen del cambio de moneda
        total: cuentaPrincipal + transacciones + historial // Sin incluir recurrentes
      },
      advertencia: 'Esta operación convertirá todas las cifras históricas excepto los pagos recurrentes. Las subcuentas y recurrentes mantendrán sus monedas individuales.',
      reversible: false
    };
  }
}
