import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DispositivoUsuario, DispositivoUsuarioDocument } from './schemas/dispositivo-usuario.schema';
import { Model } from 'mongoose';
import { Expo, ExpoPushMessage, ExpoPushTicket, ExpoPushSuccessTicket } from 'expo-server-sdk';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';

@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);
  private expo: Expo;

  constructor(
    @InjectModel(DispositivoUsuario.name)
    private readonly dispositivoModel: Model<DispositivoUsuarioDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {
    this.expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN,
      useFcmV1: true,
    });
  }

  // Registrar token de EXPO para un usuario
  async registrarExpoPushToken(userId: string, expoPushToken: string): Promise<{ registrado: boolean }> {
    if (!Expo.isExpoPushToken(expoPushToken)) {
      throw new Error('Token de EXPO inválido');
    }

    const user = await this.userModel.findOne({ id: userId });
    if (!user) throw new Error('Usuario no encontrado');

    // [expoPushTokens: READ] validar si ya existe
    // [expoPushTokens: WRITE] agregar token al array
    if (!user.expoPushTokens.includes(expoPushToken)) {
      user.expoPushTokens.push(expoPushToken);
      await user.save();
      this.logger.log(`✅ Token EXPO registrado para usuario ${userId}`);
    }

    return { registrado: true };
  }

  // Eliminar token de EXPO
  async eliminarExpoPushToken(userId: string, expoPushToken: string): Promise<{ eliminado: boolean }> {
    const user = await this.userModel.findOne({ id: userId });
    if (!user) throw new Error('Usuario no encontrado');

    // [expoPushTokens: WRITE] filtrar/eliminar token
    user.expoPushTokens = user.expoPushTokens.filter(token => token !== expoPushToken);
    await user.save();

    this.logger.log(`🗑️ Token EXPO eliminado para usuario ${userId}`);
    return { eliminado: true };
  }

  // Enviar notificación push a un usuario específico
  async enviarNotificacionPush(
    userId: string,
    titulo: string,
    mensaje: string,
    data?: Record<string, any>
  ): Promise<{ enviado: boolean; tickets?: ExpoPushTicket[] }> {
    const user = await this.userModel.findOne({ id: userId });

    // [expoPushTokens: READ] verificar existencia y longitud
    if (!user || !user.expoPushTokens || user.expoPushTokens.length === 0) {
      this.logger.warn(`⚠️ Usuario ${userId} no tiene tokens EXPO registrados`);
      return { enviado: false };
    }

    // [expoPushTokens: READ] construir mensajes a partir de tokens
    const messages: ExpoPushMessage[] = user.expoPushTokens
      .filter(token => Expo.isExpoPushToken(token))
      .map(token => ({
        to: token,
        sound: 'default',
        title: titulo,
        body: mensaje,
        data: data || {},
        priority: 'high',
      }));

    if (messages.length === 0) {
      this.logger.warn(`⚠️ No hay tokens válidos para usuario ${userId}`);
      return { enviado: false };
    }

    try {
      const chunks = this.expo.chunkPushNotifications(messages);
      const tickets: ExpoPushTicket[] = [];

      for (const chunk of chunks) {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      }

      // Limpiar tokens inválidos
      await this.limpiarTokensInvalidos(user, tickets);

      this.logger.log(`📤 Notificación enviada a usuario ${userId}: "${titulo}"`);
      return { enviado: true, tickets };
    } catch (error) {
      this.logger.error(`❌ Error enviando notificación a usuario ${userId}:`, error);
      throw error;
    }
  }

  // Enviar notificación a todos los usuarios con filtrado opcional
  async enviarNotificacionATodos(
    titulo: string,
    mensaje: string,
    data?: Record<string, any>,
    filtro: 'all' | 'active' | 'inactive' = 'all'
  ): Promise<{ enviados: number; fallidos: number }> {
    let usuarios: UserDocument[] = [];

    switch (filtro) {
      case 'all':
        // [expoPushTokens: DB QUERY] usuarios con tokens registrados
        usuarios = await this.userModel.find({
          expoPushTokens: { $exists: true, $ne: [] },
        });
        this.logger.log(`Enviando notificación a TODOS los usuarios (${usuarios.length})`);
        break;

      case 'active':
        // Usuarios con actividad en los últimos 7 días
        const hace7Dias = new Date();
        hace7Dias.setDate(hace7Dias.getDate() - 7);
        // [expoPushTokens: DB QUERY] + filtro de actividad
        usuarios = await this.userModel.find({
          lastActivityAt: { $gte: hace7Dias },
          expoPushTokens: { $exists: true, $ne: [] },
        });
        this.logger.log(`Enviando notificación a usuarios ACTIVOS (${usuarios.length})`);
        break;

      case 'inactive':
        // Usuarios sin actividad por más de 7 días
        const hace7DiasInactivos = new Date();
        hace7DiasInactivos.setDate(hace7DiasInactivos.getDate() - 7);
        // [expoPushTokens: DB QUERY] + filtro de inactividad
        usuarios = await this.userModel.find({
          lastActivityAt: { $lt: hace7DiasInactivos },
          expoPushTokens: { $exists: true, $ne: [] },
        });
        this.logger.log(`Enviando notificación a usuarios INACTIVOS (${usuarios.length})`);
        break;

      default:
        // [expoPushTokens: DB QUERY]
        usuarios = await this.userModel.find({
          expoPushTokens: { $exists: true, $ne: [] },
        });
    }

    let enviados = 0;
    let fallidos = 0;

    for (const user of usuarios) {
      try {
        await this.enviarNotificacionPush(user.id, titulo, mensaje, data);
        enviados++;
      } catch (error) {
        this.logger.error(`❌ Error enviando notificación a ${user.id}:`, error);
        fallidos++;
      }
    }

    this.logger.log(`Notificación masiva (filtro: ${filtro}): ${enviados} enviados, ${fallidos} fallidos`);
    return { enviados, fallidos };
  }

  // Limpiar tokens inválidos de un usuario
  private async limpiarTokensInvalidos(user: UserDocument, tickets: ExpoPushTicket[]): Promise<void> {
    const tokensInvalidos: string[] = [];

    tickets.forEach((ticket, index) => {
      if (ticket.status === 'error') {
        // [expoPushTokens: READ] localizar token asociado al ticket
        const errorTicket = ticket as any;
        if (
          errorTicket.details?.error === 'DeviceNotRegistered' ||
          errorTicket.message?.includes('not registered')
        ) {
          const token = user.expoPushTokens[index];
          if (token) tokensInvalidos.push(token);
        }
      }
    });

    if (tokensInvalidos.length > 0) {
      // [expoPushTokens: WRITE] remover tokens inválidos
      user.expoPushTokens = user.expoPushTokens.filter(token => !tokensInvalidos.includes(token));
      await user.save();
      this.logger.log(`🧹 Tokens inválidos eliminados para usuario ${user.id}: ${tokensInvalidos.length}`);
    }
  }

  // Verificar usuarios inactivos (sin abrir la app en 3+ días)
  async notificarUsuariosInactivos(): Promise<{ notificados: number }> {
    const tresDiasAtras = new Date();
    tresDiasAtras.setDate(tresDiasAtras.getDate() - 3);

    // [expoPushTokens: DB QUERY]
    const usuariosInactivos = await this.userModel.find({
      lastActivityAt: { $lt: tresDiasAtras },
      expoPushTokens: { $exists: true, $ne: [] },
    });

    let notificados = 0;

    for (const user of usuariosInactivos) {
      try {
        await this.enviarNotificacionPush(
          user.id,
          '💰 Registra tus gastos',
          'Hace tiempo que no te vemos. ¡Mantén tu control financiero actualizado!',
          { tipo: 'inactividad', dias: 3 }
        );
        notificados++;
      } catch (error) {
        this.logger.error(`Error notificando usuario inactivo ${user.id}:`, error);
      }
    }

    this.logger.log(`📢 Notificaciones de inactividad enviadas: ${notificados}`);
    return { notificados };
  }

  // [LEGACY] Compatibilidad con OneSignal (deprecado)
  async registrarToken(userId: string, token: string, plataforma: string, appVersion?: string) {
    const existente = await this.dispositivoModel.findOne({ userId, token });
    if (!existente) {
      await this.dispositivoModel.create({ userId, token, plataforma, appVersion });
    }
    return { registrado: true };
  }
}