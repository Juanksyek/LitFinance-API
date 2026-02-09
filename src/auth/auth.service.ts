import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomInt, randomUUID } from 'crypto';

import { RegisterAuthDto } from './dto/register-auth.dto';
import { LoginAuthDto } from './dto/login-auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto/change-password.dto';

import { User, UserDocument } from '../user/schemas/user.schema/user.schema';
import { reconcileEntitlements } from '../user/premium-entitlements';
import { Cuenta, CuentaDocument } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Moneda, MonedaDocument } from '../moneda/schema/moneda.schema';
import { EmailService } from '../email/email.service';
import { UserSession, UserSessionDocument } from './schemas/user-session.schema';
import { RefreshAuthDto } from './dto/refresh-auth.dto';
import { PlanAutoPauseService } from '../user/services/plan-auto-pause.service';

@Injectable()
export class AuthService {
    constructor(
        @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
                @InjectModel(Cuenta.name) private readonly cuentaModel: Model<CuentaDocument>,
                @InjectModel(Moneda.name) private readonly monedaModel: Model<MonedaDocument>,
                @InjectModel(UserSession.name) private readonly sessionModel: Model<UserSessionDocument>,
                private readonly jwtService: JwtService,
                private readonly emailService: EmailService,
                private readonly planAutoPauseService: PlanAutoPauseService,
    ) { }

    // Token settings (env overrides recommended)
    private readonly ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'access_secret';
    private readonly REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh_secret';
    private readonly ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
    private readonly REFRESH_TTL = process.env.JWT_REFRESH_TTL || '30d';

    private refreshExpiresDateFromNow() {
        const ms = 30 * 24 * 60 * 60 * 1000;
        return new Date(Date.now() + ms);
    }

    private async hashRefresh(token: string) {
        return bcrypt.hash(token, 10);
    }

    private async compareRefresh(token: string, hash: string) {
        return bcrypt.compare(token, hash);
    }

    private async generateTokens(params: {
        userId: string;
        email: string;
        nombre: string;
        rol: any;
        cuentaId: string | null;
        deviceId: string;
    }) {
        const jti = (randomUUID && typeof randomUUID === 'function') ? randomUUID() : randomBytes(16).toString('hex');

        const accessPayload = {
            sub: params.userId,
            email: params.email,
            nombre: params.nombre,
            rol: params.rol,
            cuentaId: params.cuentaId,
            jti,
            deviceId: params.deviceId,
            typ: 'access',
        };

        const refreshPayload = {
            sub: params.userId,
            jti,
            deviceId: params.deviceId,
            typ: 'refresh',
        };

        const accessToken = await this.jwtService.signAsync(accessPayload, {
            secret: this.ACCESS_SECRET,
            expiresIn: this.ACCESS_TTL,
        });

        const refreshToken = await this.jwtService.signAsync(refreshPayload, {
            secret: this.REFRESH_SECRET,
            expiresIn: this.REFRESH_TTL,
        });

        return { accessToken, refreshToken, jti };
    }

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

        // Log para detectar flujos incompletos
        // eslint-disable-next-line no-console
        console.log('[REGISTER] Payload recibido:', JSON.stringify(dto));

        const existing = await this.userModel.findOne({ email });
        if (existing) {
            throw new BadRequestException('El correo ya está registrado');
        }

        if (password !== confirmPassword) {
            throw new BadRequestException('Las contraseñas no coinciden');
        }

        // Validación explícita para edad y ocupacion
        if (dto.edad === undefined || dto.ocupacion === undefined) {
            throw new BadRequestException('Faltan campos obligatorios: edad y ocupacion');
        }

        // Normalizar y validar `edad`: debe ser entero y dentro del rango aceptable
        const edadNum = Number(dto.edad);
        if (!Number.isFinite(edadNum) || Number.isNaN(edadNum)) {
            throw new BadRequestException('Edad inválida');
        }

        // No permitir decimales
        if (!Number.isInteger(edadNum)) {
            throw new BadRequestException('La edad debe ser un número entero');
        }

        // Definir rango mínimo/máximo (mínimo 13 años)
        const EDAD_MIN = 13;
        const EDAD_MAX = 100;
        if (edadNum < EDAD_MIN || edadNum > EDAD_MAX) {
            throw new BadRequestException(`La edad debe estar entre ${EDAD_MIN} y ${EDAD_MAX}`);
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const generatedId = await this.generateUniqueId();

        // Forzar monedaPrincipal y monedaPreferencia a 'MXN' si no se especifican
        const monedaPrincipal = dto.monedaPrincipal ? dto.monedaPrincipal : 'MXN';
        const monedaPreferencia = dto.monedaPreferencia ? dto.monedaPreferencia : 'MXN';

        const user = new this.userModel({
            id: generatedId,
            email: dto.email,
            password: hashedPassword,
            proveedor: null,
            isActive: false,
            activationToken,
            tokenExpires,
            isPremium: dto.isPremium || false,
            monedaPrincipal,
            monedaPreferencia,
            nombreCompleto: dto.nombreCompleto,
            edad: dto.edad,
            ocupacion: dto.ocupacion,
            // otros campos opcionales del DTO
        });

        await user.save();
        await this.emailService.sendConfirmationEmail(user.email, activationToken, user.nombreCompleto);

        // Usar monedaPrincipal para la cuenta principal
        const codigoMoneda = monedaPrincipal;
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
        const { email, password, deviceId } = dto as any;

        const user = await this.userModel.findOne({ email });
        if (!user) {
            // Usuario no registrado
            throw new UnauthorizedException({
                code: 'ACCOUNT_NOT_FOUND',
                message: 'No existe una cuenta registrada con este correo.'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            // Credenciales inválidas (contraseña incorrecta)
            throw new UnauthorizedException({
                code: 'INVALID_CREDENTIALS',
                message: 'Correo o contraseña incorrectos.'
            });
        }

        // Bloquear acceso si el usuario no confirmó su correo
        if (!user.isActive) {
            throw new UnauthorizedException({
                code: 'ACCOUNT_NOT_ACTIVATED',
                message: 'Tu cuenta aún no ha sido activada. Revisa tu correo para confirmar la cuenta.'
            });
        }

        // Forzar monedaPrincipal y monedaPreferencia a 'MXN' si no existen
        let updated = false;
        if (!user.monedaPrincipal) {
            user.monedaPrincipal = 'MXN';
            updated = true;
        }
        if (!user.monedaPreferencia) {
            user.monedaPreferencia = 'MXN';
            updated = true;
        }
        if (updated) {
            await user.save();
        }

        user.lastActivityAt = new Date();
        // Mantener premium consistente en cada login (Jar vs suscripción)
        const wasPremium = user.isPremium ?? false;
        const reconciled = reconcileEntitlements(user as any, new Date());
        (user as any).isPremium = reconciled.isPremium;
        (user as any).planType = reconciled.planType;
        (user as any).premiumUntil = reconciled.premiumUntil;
        (user as any).jarExpiresAt = reconciled.jarExpiresAt;
        (user as any).jarRemainingMs = reconciled.jarRemainingMs;
        if ('premiumBonusDays' in reconciled) (user as any).premiumBonusDays = reconciled.premiumBonusDays;
        if ('premiumSubscriptionId' in reconciled) (user as any).premiumSubscriptionId = reconciled.premiumSubscriptionId;
        if ('premiumSubscriptionStatus' in reconciled) (user as any).premiumSubscriptionStatus = reconciled.premiumSubscriptionStatus;
        if ('premiumSubscriptionUntil' in reconciled) (user as any).premiumSubscriptionUntil = reconciled.premiumSubscriptionUntil;

        await user.save();
        
        // Detectar transición de premium y pausar/reanudar recursos
        const isPremiumNow = reconciled.isPremium;
        if (wasPremium !== isPremiumNow) {
            await this.planAutoPauseService.handlePlanTransition(user.id, wasPremium, isPremiumNow);
        }

        const cuentaPrincipal = await this.cuentaModel.findOne({ userId: user.id, isPrincipal: true });

        const { accessToken, refreshToken, jti } = await this.generateTokens({
            userId: user.id,
            email: user.email,
            nombre: user.nombreCompleto,
            rol: user.rol,
            cuentaId: cuentaPrincipal?.id || null,
            deviceId: deviceId || 'default',
        });

        const refreshHash = await this.hashRefresh(refreshToken);
        const expiresAt = this.refreshExpiresDateFromNow();

        await this.sessionModel.updateOne(
            { userId: user.id, deviceId: deviceId || 'default' },
            {
                $set: {
                    jti,
                    refreshHash,
                    revoked: false,
                    expiresAt,
                    lastUsedAt: new Date(),
                },
            },
            { upsert: true },
        );

        return {
            message: 'Login exitoso',
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                nombre: user.nombreCompleto,
                premiumSubscriptionStatus: user.premiumSubscriptionStatus || null,
                premiumUntil: user.premiumUntil || null,
            },
            rol: user.rol,
        };
    }

    async confirmAccount(token: string) {
        // Intentar update atómico: buscar por token válido y fecha de expiración
        const now = new Date();
        let updatedUser = await this.userModel.findOneAndUpdate(
            { activationToken: token, tokenExpires: { $gt: now } },
            {
                $set: { isActive: true },
                $unset: { activationToken: '', tokenExpires: '' },
            },
            { new: true },
        );

        // Si no se actualizó, intentar variantes para depuración y recuperación automática
        if (!updatedUser) {
            // 1) Probar token URL-decodeado por si el cliente envió una versión codificada
            try {
                const decoded = decodeURIComponent(token);
                if (decoded && decoded !== token) {
                    updatedUser = await this.userModel.findOneAndUpdate(
                        { activationToken: decoded, tokenExpires: { $gt: now } },
                        {
                            $set: { isActive: true },
                            $unset: { activationToken: '', tokenExpires: '' },
                        },
                        { new: true },
                    );
                }
            } catch (e) {
                // ignore decode errors
            }
        }

        // 2) Si aún no hay resultado, verificar si existe un usuario con ese token (posible expirado)
        if (!updatedUser) {
            const found = (await this.userModel.findOne({ activationToken: token })) ||
                (await (async () => {
                    try { const d = decodeURIComponent(token); return d === token ? null : await this.userModel.findOne({ activationToken: d }); } catch { return null; }
                })());

            if (found) {
                if (!found.tokenExpires || found.tokenExpires < now) {
                    throw new BadRequestException('Token inválido o expirado');
                }

                // Si por alguna razón la actualización atómica falló pero el token es válido,
                // forzamos la activación para evitar dejar cuentas inaccesibles.
                const forced = await this.userModel.findOneAndUpdate(
                    { id: found.id },
                    { $set: { isActive: true }, $unset: { activationToken: '', tokenExpires: '' } },
                    { new: true },
                );

                if (forced && forced.isActive) {
                    return { success: true, message: 'Cuenta activada correctamente' };
                }
            }

            throw new BadRequestException('Token inválido o expirado');
        }

        if (!updatedUser.isActive) {
            throw new BadRequestException('No se pudo activar la cuenta. Contacta soporte.');
        }

        return { success: true, message: 'Cuenta activada correctamente' };
    }

    async resendActivation(email: string) {
        if (!email) throw new BadRequestException('Email no proporcionado');

        const user = await this.userModel.findOne({ email });
        if (!user) {
            // No revelar si existe o no por seguridad
            return { success: true, message: 'Si el correo existe, enviaremos un enlace de activación.' };
        }

        if (user.isActive) {
            return { success: true, message: 'La cuenta ya está activada. Inicia sesión.' };
        }

        const activationToken = randomBytes(32).toString('hex');
        const tokenExpires = new Date(Date.now() + 30 * 60 * 1000);

        user.activationToken = activationToken;
        user.tokenExpires = tokenExpires;
        await user.save();

        await this.emailService.sendConfirmationEmail(user.email, activationToken, user.nombreCompleto);

        return { success: true, message: 'Enlace de activación reenviado. Revisa tu correo.' };
    }

        // ------------------------------
        // REFRESH: sesión extendida (sliding)
        // ------------------------------
        async refreshTokens(dto: RefreshAuthDto) {
            const { refreshToken, deviceId } = dto as any;

            let decoded: any;
            try {
                decoded = await this.jwtService.verifyAsync(refreshToken, { secret: this.REFRESH_SECRET });
            } catch {
                throw new UnauthorizedException('Refresh token inválido o expirado');
            }

            if (decoded?.typ !== 'refresh') {
                throw new UnauthorizedException('Token inválido');
            }

            const userId = decoded.sub as string;

            const session = await this.sessionModel.findOne({ userId, deviceId });
            if (!session || session.revoked) {
                throw new UnauthorizedException('Sesión no válida');
            }

            if (session.expiresAt < new Date()) {
                throw new UnauthorizedException('Sesión expirada');
            }

            const ok = await this.compareRefresh(refreshToken, session.refreshHash);
            if (!ok) {
                session.revoked = true;
                await session.save();
                throw new UnauthorizedException('Sesión comprometida. Inicia sesión de nuevo.');
            }

            const user = await this.userModel.findOne({ id: userId });
            if (!user) throw new UnauthorizedException('Usuario no válido');

            const cuentaPrincipal = await this.cuentaModel.findOne({ userId: user.id, isPrincipal: true });

            const { accessToken, refreshToken: newRefresh, jti } = await this.generateTokens({
                userId: user.id,
                email: user.email,
                nombre: user.nombreCompleto,
                rol: user.rol,
                cuentaId: cuentaPrincipal?.id || null,
                deviceId,
            });

            session.jti = jti;
            session.refreshHash = await this.hashRefresh(newRefresh);
            session.expiresAt = this.refreshExpiresDateFromNow();
            session.lastUsedAt = new Date();
            session.revoked = false;
            await session.save();

            return {
                accessToken,
                refreshToken: newRefresh,
            };
        }

        // ------------------------------
        // LOGOUT: revoca por dispositivo
        // ------------------------------
        async logout(userId: string, deviceId: string) {
            await this.sessionModel.updateOne(
                { userId, deviceId },
                { $set: { revoked: true } },
            );
            return { message: 'Sesión cerrada' };
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
