import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User, UserSchema } from './schemas/user.schema/user.schema';
import { CleanupService } from './services/cleanup.service';
import { CuentaModule } from '../cuenta/cuenta.module';
import { SubcuentaModule } from 'src/subcuenta/subcuenta.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    CuentaModule,
    SubcuentaModule,
  ],
  controllers: [UserController],
  providers: [UserService, CleanupService],
  exports: [MongooseModule],
})
export class UserModule {}
