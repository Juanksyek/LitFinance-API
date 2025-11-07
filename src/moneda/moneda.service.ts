import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { Moneda, MonedaDocument } from './schema/moneda.schema';
import { CreateMonedaDto } from './dto/create.moneda.dto';
import { CatalogoMonedaDto } from './dto/catalogo-moneda.dto';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import axios from 'axios';
import { randomBytes } from 'crypto';

@Injectable()
export class MonedaService {
  constructor(
    @InjectModel(Moneda.name) private monedaModel: Model<MonedaDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  // Helper: obtener usuario por _id (ObjectId) o por id (string externo en tu schema)
  private async findUserByAnyId(userTokenId?: string) {
    if (!userTokenId) return null;
    if (isValidObjectId(userTokenId)) {
      return this.userModel.findById(userTokenId).select('monedasFavoritas').lean().exec();
    }
    return this.userModel.findOne({ id: userTokenId }).select('monedasFavoritas').lean().exec();
  }

  async listarMonedas(): Promise<Moneda[]> {
    return this.monedaModel.find();
  }

  async listarMonedasConFavoritas(userId?: string): Promise<{
    favoritas: any[];
    otras: any[];
    total: number;
    totalFavoritas: number;
  }> {
    const todasLasMonedas = await this.monedaModel
      .find()
      .sort({ nombre: 1 })
      .lean()
      .exec();

    if (!userId) {
      const otras = todasLasMonedas.map((m) => ({ ...m, esFavorita: false }));
      return { favoritas: [], otras, total: otras.length, totalFavoritas: 0 };
    }

    const user = await this.findUserByAnyId(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado con el identificador del token');
    }

    const favSet = new Set<string>(user.monedasFavoritas || []);
    const favoritas: any[] = [];
    const otras: any[] = [];

    for (const moneda of todasLasMonedas) {
      if (favSet.has(moneda.codigo)) {
        favoritas.push({ ...moneda, esFavorita: true });
      } else {
        otras.push({ ...moneda, esFavorita: false });
      }
    }

    return {
      favoritas,
      otras,
      total: todasLasMonedas.length,
      totalFavoritas: favoritas.length,
    };
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

  async obtenerCatalogoPublico(): Promise<CatalogoMonedaDto[]> {
    try {
      const monedas = await this.monedaModel
        .find({}, { _id: 0, codigo: 1, nombre: 1, simbolo: 1 })
        .sort({ nombre: 1 })
        .limit(100)
        .lean()
        .exec();

      return monedas.map((moneda) => ({
        codigo: String(moneda.codigo).trim(),
        nombre: String(moneda.nombre).trim(),
        simbolo: String(moneda.simbolo).trim(),
      }));
    } catch (error) {
      throw new Error('Error interno del servidor');
    }
  }

  async toggleFavorita(userId: string, codigoMoneda: string): Promise<{
    esFavorita: boolean;
    monedasFavoritas: string[];
    message: string;
  }> {
    const existe = await this.monedaModel.exists({ codigo: codigoMoneda });
    if (!existe) {
      throw new NotFoundException(`Moneda ${codigoMoneda} no existe`);
    }

    let userDoc: UserDocument | null = null;
    if (isValidObjectId(userId)) {
      userDoc = await this.userModel.findById(userId).select('monedasFavoritas').exec();
    } else {
      userDoc = await this.userModel.findOne({ id: userId }).select('monedasFavoritas').exec();
    }
    if (!userDoc) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const yaEsFav = (userDoc.monedasFavoritas || []).includes(codigoMoneda);

    if (yaEsFav) {
      userDoc.monedasFavoritas = userDoc.monedasFavoritas.filter((c) => c !== codigoMoneda);
    } else {
      userDoc.monedasFavoritas = Array.from(
        new Set([...(userDoc.monedasFavoritas || []), codigoMoneda]),
      );
    }

    await userDoc.save();

    const esFavorita = !yaEsFav;
    return {
      esFavorita,
      monedasFavoritas: userDoc.monedasFavoritas,
      message: esFavorita
        ? `Moneda ${codigoMoneda} añadida a favoritas`
        : `Moneda ${codigoMoneda} removida de favoritas`,
    };
  }
}