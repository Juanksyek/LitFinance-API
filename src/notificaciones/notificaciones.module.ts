import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificacionesService } from './notificaciones.service';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesCronService } from './notificaciones-cron.service';
import { DispositivoUsuario, DispositivoUsuarioSchema } from './schemas/dispositivo-usuario.schema';
import { User, UserSchema } from '../user/schemas/user.schema/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DispositivoUsuario.name, schema: DispositivoUsuarioSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [NotificacionesService, NotificacionesCronService],
  controllers: [NotificacionesController],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}