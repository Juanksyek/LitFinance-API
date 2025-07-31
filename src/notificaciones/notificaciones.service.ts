// commnt
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DispositivoUsuario, DispositivoUsuarioDocument } from './schemas/dispositivo-usuario.schema';
import { Model } from 'mongoose';
import axios from 'axios';

@Injectable()
export class NotificacionesService {
  private readonly oneSignalApiUrl = process.env.ONESIGNAL_API_URL;
  private readonly appId = process.env.ONESIGNAL_APP_ID;
  private readonly apiKey = process.env.ONESIGNAL_API_KEY;

  constructor(
    @InjectModel(DispositivoUsuario.name)
    private readonly dispositivoModel: Model<DispositivoUsuarioDocument>,
  ) {}

  async registrarToken(userId: string, token: string, plataforma: string, appVersion?: string) {
    const existente = await this.dispositivoModel.findOne({ userId, token });
    if (!existente) {
      await this.dispositivoModel.create({ userId, token, plataforma, appVersion });
    }
    return { registrado: true };
  }

  async enviarNotificacionPush(userId: string, titulo: string, mensaje: string) {
    const dispositivos = await this.dispositivoModel.find({ userId });

    for (const d of dispositivos) {
      await this.enviarViaOneSignal(d.token, titulo, mensaje);
    }
  }

  private async enviarViaOneSignal(token: string, titulo: string, cuerpo: string) {
    const payload = {
      app_id: this.appId,
      include_player_ids: [token],
      headings: { en: titulo },
      contents: { en: cuerpo },
    };

    if (!this.oneSignalApiUrl) {
      throw new Error('OneSignal API URL is not defined');
    }
    await axios.post(this.oneSignalApiUrl, payload, {
      headers: {
        Authorization: `Basic ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }
}