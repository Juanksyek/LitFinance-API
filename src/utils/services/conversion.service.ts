import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Moneda } from '../../moneda/schema/moneda.schema';

@Injectable()
export class ConversionService {
  constructor(
    @InjectModel(Moneda.name) private monedaModel: Model<Moneda>,
  ) {}

  /**
   * Convierte un monto de una moneda a otra usando las tasas base almacenadas
   * @param monto - Cantidad a convertir
   * @param codigoOrigen - Código ISO de moneda origen (ej: 'USD')
   * @param codigoDestino - Código ISO de moneda destino (ej: 'MXN')
   * @returns Monto convertido y metadata de la conversión
   */
  async convertir(
    monto: number,
    codigoOrigen: string,
    codigoDestino: string,
  ): Promise<{
    montoOriginal: number;
    monedaOrigen: string;
    montoConvertido: number;
    monedaDestino: string;
    tasaConversion: number;
    fechaConversion: Date;
  }> {
    // Si es la misma moneda, retornar sin conversión
    if (codigoOrigen === codigoDestino) {
      return {
        montoOriginal: monto,
        monedaOrigen: codigoOrigen,
        montoConvertido: monto,
        monedaDestino: codigoDestino,
        tasaConversion: 1,
        fechaConversion: new Date(),
      };
    }

    // Obtener las monedas desde la BD
    const [monedaOrigen, monedaDestino] = await Promise.all([
      this.monedaModel.findOne({ codigo: codigoOrigen }).exec(),
      this.monedaModel.findOne({ codigo: codigoDestino }).exec(),
    ]);

    if (!monedaOrigen) {
      throw new BadRequestException(
        `Moneda origen '${codigoOrigen}' no encontrada`,
      );
    }

    if (!monedaDestino) {
      throw new BadRequestException(
        `Moneda destino '${codigoDestino}' no encontrada`,
      );
    }

    // Calcular tasa de conversión
    // Si origen es USD (tasaBase=17.5) y destino es MXN (tasaBase=1):
    // tasa = 17.5 / 1 = 17.5
    // montoConvertido = 100 USD * 17.5 = 1750 MXN
    const tasaConversion = monedaOrigen.tasaBase / monedaDestino.tasaBase;
    const montoConvertido = monto * tasaConversion;

    return {
      montoOriginal: monto,
      monedaOrigen: codigoOrigen,
      montoConvertido: parseFloat(montoConvertido.toFixed(2)), // Redondear a 2 decimales
      monedaDestino: codigoDestino,
      tasaConversion: parseFloat(tasaConversion.toFixed(6)), // Mantener precisión en la tasa
      fechaConversion: new Date(),
    };
  }

  /**
   * Convierte múltiples montos de una sola vez (útil para reportes)
   * @param conversiones - Array de conversiones a realizar
   * @returns Array con los resultados de cada conversión
   */
  async convertirMultiple(
    conversiones: Array<{
      monto: number;
      codigoOrigen: string;
      codigoDestino: string;
    }>,
  ): Promise<
    Array<{
      montoOriginal: number;
      monedaOrigen: string;
      montoConvertido: number;
      monedaDestino: string;
      tasaConversion: number;
      fechaConversion: Date;
    }>
  > {
    return Promise.all(
      conversiones.map((conv) =>
        this.convertir(conv.monto, conv.codigoOrigen, conv.codigoDestino),
      ),
    );
  }

  /**
   * Obtiene la tasa de conversión actual entre dos monedas sin hacer la conversión
   * @param codigoOrigen - Código ISO de moneda origen
   * @param codigoDestino - Código ISO de moneda destino
   * @returns Tasa de conversión actual
   */
  async obtenerTasa(
    codigoOrigen: string,
    codigoDestino: string,
  ): Promise<number> {
    if (codigoOrigen === codigoDestino) {
      return 1;
    }

    const [monedaOrigen, monedaDestino] = await Promise.all([
      this.monedaModel.findOne({ codigo: codigoOrigen }).exec(),
      this.monedaModel.findOne({ codigo: codigoDestino }).exec(),
    ]);

    if (!monedaOrigen || !monedaDestino) {
      throw new BadRequestException('Una o ambas monedas no encontradas');
    }

    return parseFloat(
      (monedaOrigen.tasaBase / monedaDestino.tasaBase).toFixed(6),
    );
  }
}
