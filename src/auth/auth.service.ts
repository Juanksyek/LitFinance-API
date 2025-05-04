import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';

import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { EmailService } from '../email/email.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto/reset-password.dto';
import { Cuenta, CuentaDocument } from '../cuenta/schemas/cuenta.schema/cuenta.schema';

@Injectable()
export class AuthService {
    constructor(
        @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
        @InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
        private readonly jwtService: JwtService,
        private readonly emailService: EmailService,
    ) { }

    private async generateUniqueId(): Promise<string> {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let id: string;
        let exists: UserDocument | null;

        do {
            id = '';
            for (let i = 0; i < 7; i++) {
                id += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            exists = await this.userModel.findOne({ id });
        } while (exists);

        return id;
    }

    async register(dto: RegisterAuthDto) {
        const activationToken = randomBytes(32).toString('hex');
        const tokenExpires = new Date(Date.now() + 30 * 60 * 1000);
        const { email, password, confirmPassword } = dto;

        const existing = await this.userModel.findOne({ email });
        if (existing) {
            throw new BadRequestException('El correo ya está registrado');
        }

        if (password !== confirmPassword) {
            throw new BadRequestException('Las contraseñas no coinciden');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const generatedId = await this.generateUniqueId();

        const user = new this.userModel({
            ...dto,
            id: generatedId,
            password: hashedPassword,
            proveedor: null,
            isActive: false,
            activationToken,
            tokenExpires,
        });

        await user.save();
        await this.emailService.sendConfirmationEmail(user.email, activationToken, user.nombreCompleto);

        const cuentaPrincipal = new this.cuentaModel({
            id: await this.generateUniqueId(),
            usuarioId: user.id,
            nombre: 'Cuenta Principal',
            moneda: 'MXN',
            cantidad: 0,
            simbolo: '$',
            color: '#1A2C23',
            isPrincipal: true,
          });
          
          await cuentaPrincipal.save();

        return {
            message: 'Usuario registrado correctamente',
            userId: user.id,
        };
    }

    async login(dto: LoginAuthDto) {
        const { email, password } = dto;

        const user = await this.userModel.findOne({ email });
        if (!user) {
            throw new UnauthorizedException('Credenciales inválidas');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            throw new UnauthorizedException('Credenciales inválidas');
        }

        user.lastActivityAt = new Date();
        await user.save();

        const payload = {
            sub: user.id,
            email: user.email,
            nombre: user.nombreCompleto,
            rol: user.rol,
        };

        const accessToken = await this.jwtService.signAsync(payload);

        return {
            message: 'Login exitoso',
            accessToken,
            user: {
                id: user.id,
                email: user.email,
                nombre: user.nombreCompleto,
            },
            rol: user.rol,
        };
    }

    async confirmAccount(token: string) {
        const user = await this.userModel.findOne({ activationToken: token });

        if (!user || !user.tokenExpires || user.tokenExpires < new Date()) {
            throw new BadRequestException('Token inválido o expirado');
        }

        user.isActive = true;
        user.activationToken = undefined;
        user.tokenExpires = undefined;
        await user.save();

        return { success: true, message: 'Cuenta activada correctamente' };
    }

    async forgotPassword(dto: ForgotPasswordDto) {
        const user = await this.userModel.findOne({ email: dto.email });

        if (!user) {
            throw new BadRequestException('No existe una cuenta con ese correo.');
        }

        const resetToken = randomBytes(32).toString('hex');
        const resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000);

        user.resetToken = resetToken;
        user.resetTokenExpires = resetTokenExpires;
        await user.save();

        await this.emailService.sendResetPasswordEmail(user.email, resetToken, user.nombreCompleto);

        return { message: 'Se ha enviado un correo para recuperar la contraseña.', resetToken };
    }

    async resetPassword(dto: ResetPasswordDto) {
        const { token, newPassword } = dto;

        const user = await this.userModel.findOne({ resetToken: token });

        if (!user || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
            throw new BadRequestException('Token inválido o expirado.');
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        user.password = hashedPassword;
        user.resetToken = undefined;
        user.resetTokenExpires = undefined;
        await user.save();

        return { message: 'La contraseña ha sido cambiada exitosamente.' };
    }
}
