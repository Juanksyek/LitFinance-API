import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomInt } from 'crypto';

import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto/change-password.dto';

import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { Cuenta, CuentaDocument } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Moneda, MonedaDocument } from '../moneda/schema/moneda.schema';
import { EmailService } from '../email/email.service';

@Injectable()
export class AuthService {
    constructor(
        @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
        @InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
        @InjectModel(Moneda.name) private readonly monedaModel: Model<MonedaDocument>,
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
            isPremium: dto.isPremium || false,
            monedaPreferencia: dto.monedaPreferencia || 'USD',
        });

        await user.save();
        await this.emailService.sendConfirmationEmail(user.email, activationToken, user.nombreCompleto);
        
        const codigoMoneda = dto.monedaPreferencia || 'USD';
        const monedaSeleccionada = await this.getMonedaInfo(codigoMoneda);

        let cuentaPrincipalId: string;
        let cuentaExists: CuentaDocument | null;
        do {
            cuentaPrincipalId = await this.generateUniqueId();
            cuentaExists = await this.cuentaModel.findOne({ id: cuentaPrincipalId });
        } while (cuentaExists);

        const cuentaPrincipal = new this.cuentaModel({
            id: cuentaPrincipalId,
            userId: user.id,
            nombre: 'Cuenta Principal',
            moneda: codigoMoneda,
            cantidad: 0,
            simbolo: monedaSeleccionada.simbolo,
            color: '#EF6C00',
            isPrincipal: true,
        });

        try {
            await cuentaPrincipal.save();
        } catch (error) {
            await this.userModel.deleteOne({ id: user.id });
            throw new BadRequestException('No se pudo crear la cuenta principal. Intenta de nuevo.');
        }

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

        const cuentaPrincipal = await this.cuentaModel.findOne({ userId: user.id, isPrincipal: true });

        const payload = {
          sub: user.id,
          email: user.email,
          nombre: user.nombreCompleto,
          rol: user.rol,
          cuentaId: cuentaPrincipal?.id || null,
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

        const updatedUser = await this.userModel.findOne({ id: user.id });
        if (!updatedUser?.isActive) {
            throw new BadRequestException('No se pudo activar la cuenta. Contacta soporte.');
        }

        return { success: true, message: 'Cuenta activada correctamente' };
    }

    async forgotPassword(dto: ForgotPasswordDto) {
        const user = await this.userModel.findOne({ email: dto.email });

        if (!user) {
            throw new BadRequestException('No existe una cuenta con ese correo.');
        }

        const code = randomInt(1000, 9999).toString();
        const expires = new Date(Date.now() + 10 * 60 * 1000);

        user.resetCode = code;
        user.resetExpires = expires;
        await user.save();

        await this.emailService.sendResetPasswordCode(user.email, code, user.nombreCompleto);

        return { message: 'Se ha enviado un código de recuperación a tu correo.' };
    }

    async resetPassword(dto: ResetPasswordDto) {
        const { email, code, newPassword, confirmPassword } = dto;

        const user = await this.userModel.findOne({ email });

        if (
            !user ||
            user.resetCode !== code ||
            !user.resetExpires ||
            user.resetExpires < new Date()
        ) {
            throw new BadRequestException('Código inválido o expirado.');
        }

        if (newPassword !== confirmPassword) {
            throw new BadRequestException('Las contraseñas no coinciden.');
        }

        user.password = await bcrypt.hash(newPassword, 10);
        user.resetCode = undefined;
        user.resetExpires = undefined;
        await user.save();

        return { message: 'La contraseña ha sido cambiada exitosamente.' };
    }

    async changePassword(userId: string, dto: ChangePasswordDto) {
        const { currentPassword, newPassword, confirmPassword } = dto;

        const user = await this.userModel.findOne({ id: userId });

        if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
            throw new BadRequestException('La contraseña actual es incorrecta.');
        }

        if (newPassword !== confirmPassword) {
            throw new BadRequestException('Las contraseñas no coinciden.');
        }

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        return { message: 'Contraseña actualizada correctamente.' };
    }

    private async getMonedaInfo(codigo: string) {
        const moneda = await this.monedaModel.findOne({ codigo });
        if (!moneda) {
            throw new BadRequestException(`La moneda ${codigo} no existe`);
        }
        return moneda;
    }
}
