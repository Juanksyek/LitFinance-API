import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';
import { EmailModule } from '../email/enail.module';

@Module({
  imports: [
    UserModule,
    JwtModule.register({ secret: 'mySecret', signOptions: { expiresIn: '1d' } }),
    EmailModule
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
