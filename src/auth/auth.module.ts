import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';
import { EmailModule } from '../email/email.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CuentaModule } from '../cuenta/cuenta.module';
import { MonedaModule } from '../moneda/moneda.module';
import { UserSession, UserSessionSchema } from './schemas/user-session.schema';
import { PasswordReset, PasswordResetSchema } from './schemas/password-reset.schema';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetController } from './password-reset.controller';

@Module({
  imports: [
    UserModule,
    MongooseModule.forFeature([
      { name: UserSession.name, schema: UserSessionSchema },
      { name: PasswordReset.name, schema: PasswordResetSchema },
    ]),
    EmailModule,
    CuentaModule,
    MonedaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
  ],
  controllers: [AuthController, PasswordResetController],
  providers: [AuthService, JwtStrategy, PasswordResetService],
  exports: [AuthService],
})
export class AuthModule {}
