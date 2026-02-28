import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Moneda, MonedaDocument } from '../../moneda/schema/moneda.schema';

@Injectable()
export class ExchangeRateService {
  constructor(@InjectModel(Moneda.name) private readonly monedaModel: Model<MonedaDocument>) {}

  async getRate(from: string, to: string): Promise<{ rate: number; asOf: Date; source: string }> {
    if (!from || !to) throw new BadRequestException('Monedas inválidas');
    if (from === to) {
      return { rate: 1, asOf: new Date(), source: 'catalog' };
    }

    const [monedaOrigen, monedaDestino] = await Promise.all([
      this.monedaModel.findOne({ codigo: from }).lean(),
      this.monedaModel.findOne({ codigo: to }).lean(),
    ]);

    if (!monedaOrigen) throw new BadRequestException(`Moneda origen '${from}' no encontrada`);
    if (!monedaDestino) throw new BadRequestException(`Moneda destino '${to}' no encontrada`);

    const rate = Number((monedaOrigen.tasaBase / monedaDestino.tasaBase).toFixed(6));

    const asOfMs = Math.min(
      new Date(monedaOrigen.ultimaActualizacion ?? Date.now()).getTime(),
      new Date(monedaDestino.ultimaActualizacion ?? Date.now()).getTime(),
    );

    return { rate, asOf: new Date(asOfMs), source: 'catalog' };
  }
}
