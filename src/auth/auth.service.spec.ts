import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcryptjs';
import { User } from '../user/schemas/user.schema/user.schema';
import { Cuenta } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let userModel: any;
  let cuentaModel: any;
  let jwtService: any;
  let emailService: any;

  beforeEach(async () => {
    userModel = jest.fn().mockImplementation((data) => ({
      ...data,
      save: jest.fn(),
    }));
    
    userModel.findOne = jest.fn();


    cuentaModel = jest.fn().mockImplementation((data) => ({
      ...data,
      save: jest.fn(),
    }));
    
    cuentaModel.create = jest.fn();

    jwtService = {
      signAsync: jest.fn(),
    };

    emailService = {
      sendConfirmationEmail: jest.fn(),
      sendResetPasswordEmail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Cuenta.name), useValue: cuentaModel },
        { provide: JwtService, useValue: jwtService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('debe registrar usuario y crear cuenta principal', async () => {
      userModel.findOne.mockResolvedValue(null);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashedPass' as never);
      userModel.prototype.save = jest.fn().mockResolvedValue(undefined);
      cuentaModel.create = jest.fn().mockResolvedValue(undefined);

      const result = await service.register({
        email: 'test@mail.com',
        password: '123456',
        confirmPassword: '123456',
        nombreCompleto: 'Test',
        edad: 25,
        ocupacion: 'Estudiante',
      });

      expect(result.message).toBe('Usuario registrado correctamente');
      expect(emailService.sendConfirmationEmail).toHaveBeenCalled();
    });

    it('debe fallar si el correo ya existe', async () => {
      userModel.findOne.mockResolvedValue({ email: 'test@mail.com' });

      await expect(
        service.register({
          email: 'test@mail.com',
          password: '123456',
          confirmPassword: '123456',
          nombreCompleto: 'Test',
          edad: 25,
          ocupacion: 'Estudiante',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe fallar si las contraseñas no coinciden', async () => {
      userModel.findOne.mockResolvedValue(null);

      await expect(
        service.register({
          email: 'test@mail.com',
          password: '123456',
          confirmPassword: 'nope',
          nombreCompleto: 'Test',
          edad: 25,
          ocupacion: 'Estudiante',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('login', () => {
    it('debe loguear y devolver token', async () => {
      const fakeUser = {
        email: 'test@mail.com',
        password: 'hashed',
        id: 'abc123',
        nombreCompleto: 'Juan',
        rol: 'usuario',
        save: jest.fn(),
      };

      userModel.findOne.mockResolvedValue(fakeUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jwtService.signAsync.mockResolvedValue('token123');

      const result = await service.login({ email: 'test@mail.com', password: '123456' });

      expect(result.accessToken).toBe('token123');
      expect(result.user.id).toBe('abc123');
    });

    it('debe fallar si el usuario no existe', async () => {
      userModel.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'notfound@mail.com', password: '123456' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('debe fallar si la contraseña no coincide', async () => {
      userModel.findOne.mockResolvedValue({ password: 'hashed' });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.login({ email: 'test@mail.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('confirmAccount', () => {
    it('debe activar la cuenta si el token es válido', async () => {
      const fakeUser = {
        tokenExpires: new Date(Date.now() + 10000),
        save: jest.fn(),
      };
      userModel.findOne.mockResolvedValue(fakeUser);

      const result = await service.confirmAccount('token123');

      expect(result.success).toBe(true);
      expect(fakeUser.save).toHaveBeenCalled();
    });

    it('debe fallar si el token es inválido o expirado', async () => {
      userModel.findOne.mockResolvedValue(null);

      await expect(service.confirmAccount('invalid')).rejects.toThrow(BadRequestException);
    });
  });

  describe('forgotPassword', () => {
    it('debe generar token de recuperación', async () => {
      const fakeUser = {
        email: 'test@mail.com',
        nombreCompleto: 'Juan',
        save: jest.fn(),
      };

      userModel.findOne.mockResolvedValue(fakeUser);

      const result = await service.forgotPassword({ email: 'test@mail.com' });

      expect(result.message).toContain('correo');
      expect(emailService.sendResetPasswordEmail).toHaveBeenCalled();
    });

    it('debe fallar si el correo no existe', async () => {
      userModel.findOne.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ email: 'noexiste@mail.com' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resetPassword', () => {
    it('debe cambiar la contraseña si el token es válido', async () => {
      const fakeUser = {
        resetTokenExpires: new Date(Date.now() + 10000),
        save: jest.fn(),
      };

      userModel.findOne.mockResolvedValue(fakeUser);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashedNew' as never);

      const result = await service.resetPassword({ token: 'abc', newPassword: '123456' });

      expect(result.message).toContain('contraseña');
      expect(fakeUser.save).toHaveBeenCalled();
    });

    it('debe fallar si el token es inválido o expirado', async () => {
      userModel.findOne.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'nope', newPassword: '123' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
