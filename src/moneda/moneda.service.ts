import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Moneda, MonedaDocument } from './schema/moneda.schema';
import { CreateMonedaDto } from './dto/create.moneda.dto';
import axios from 'axios';
import { randomBytes } from 'crypto';

@Injectable()
export class MonedaService {
  constructor(
    @InjectModel(Moneda.name) private monedaModel: Model<MonedaDocument>,
  ) {}

  async listarMonedas(): Promise<Moneda[]> {
    return this.monedaModel.find();
  }

  async crearMoneda(dto: CreateMonedaDto): Promise<Moneda> {
    const id = randomBytes(4).toString('hex');
    const moneda = new this.monedaModel({ ...dto, id });
    return moneda.save();
  }

  async obtenerTasaCambio(base: string, destino: string): Promise<any> {
    const apiKey = process.env.EXCHANGE_RATE_API_KEY;
    const url = `https://v6.exchangerate-api.com/v6/${apiKey}/pair/${base}/${destino}`;

    interface ExchangeRateResponse {
      result: string;
      conversion_rate: number;
      time_last_update_utc: string;
    }

    try {
      const { data } = await axios.get<ExchangeRateResponse>(url);
      if (data && data.result === 'success') {
        return {
          base,
          destino,
          tasa: data.conversion_rate,
          actualizado: data.time_last_update_utc,
        };
      } else {
        throw new Error('Error en la respuesta de ExchangeRate API');
      }
    } catch (error) {
      throw new Error('Error al obtener tasa de cambio');
    }
  }

  async intercambiarDivisa(monto: number, base: string, destino: string): Promise<any> {
    const tasa = await this.obtenerTasaCambio(base, destino);
    const montoConvertido = monto * tasa.tasa;
    return {
      base,
      destino,
      montoOriginal: monto,
      montoConvertido,
      tasa: tasa.tasa,
      actualizado: tasa.actualizado,
    };
  }

  async poblarCatalogoDivisas(divisas: CreateMonedaDto[]): Promise<Moneda[]> {
    const resultados: Moneda[] = [];
  
    for (const dto of divisas) {
      const id = randomBytes(4).toString('hex');
      const moneda = new this.monedaModel({ ...dto, id });
      const guardada = await moneda.save();
      resultados.push(guardada);
    }
  
    return resultados;
  }
}