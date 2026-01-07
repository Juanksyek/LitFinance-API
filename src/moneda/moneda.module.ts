import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MonedaController } from './moneda.controller';
import { MonedaService } from './moneda.service';
import { MonedaCronService } from './moneda-cron.service';
import { Moneda, MonedaSchema } from './schema/moneda.schema';
import { User, UserSchema } from '../user/schemas/user.schema/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Moneda.name, schema: MonedaSchema },
      { name: User.name, schema: UserSchema }
    ]),
  ],
  controllers: [MonedaController],
  providers: [MonedaService, MonedaCronService],
  exports: [
    MonedaService,
    MongooseModule
  ],
})
export class MonedaModule {}