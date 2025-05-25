import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getModelToken } from '@nestjs/mongoose';
import { User } from './schemas/user.schema/user.schema';
import { NotFoundException } from '@nestjs/common';

describe('UserService', () => {
  let service: UserService;
  const mockUserModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getProfile', () => {
    it('debe retornar el usuario si existe', async () => {
      const mockUser = { id: 'abc123', nombre: 'Juan' };
      mockUserModel.findOne.mockResolvedValue(mockUser);

      const result = await service.getProfile('abc123');
      expect(result).toEqual(mockUser);
    });

    it('debe lanzar NotFoundException si el usuario no existe', async () => {
      mockUserModel.findOne.mockResolvedValue(null);

      await expect(service.getProfile('inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('debe actualizar el perfil del usuario', async () => {
      const mockUser = { id: 'abc123', nombre: 'Actualizado' };
      mockUserModel.findOneAndUpdate.mockResolvedValue(mockUser);

      const result = await service.updateProfile('abc123', { nombre: 'Actualizado' });
      expect(result).toEqual({
        message: 'Perfil actualizado correctamente',
        user: mockUser,
      });
    });

    it('debe lanzar NotFoundException si no se actualiza', async () => {
      mockUserModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.updateProfile('inexistente', {})).rejects.toThrow(NotFoundException);
    });
  });
});