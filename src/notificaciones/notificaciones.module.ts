import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificacionesService } from './notificaciones.service';
import { NotificacionesController } from './notificaciones.controller';
import { DispositivoUsuario, DispositivoUsuarioSchema } from './schemas/dispositivo-usuario.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DispositivoUsuario.name, schema: DispositivoUsuarioSchema },
    ]),
  ],
  providers: [NotificacionesService],
  controllers: [NotificacionesController],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}