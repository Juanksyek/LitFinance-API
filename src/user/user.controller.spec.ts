import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { CleanupService } from './services/cleanup.service';

describe('UserController', () => {
  let controller: UserController;

  const mockUserService = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
  };

  const mockCleanupService = {
    deleteInactiveUsers: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: mockUserService },
        { provide: CleanupService, useValue: mockCleanupService },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getProfile debe invocar userService con el userId', async () => {
    const req = { user: { sub: 'usuario123' } };
    mockUserService.getProfile.mockResolvedValue({ id: 'usuario123' });

    const result = await controller.getProfile(req);
    expect(mockUserService.getProfile).toHaveBeenCalledWith('usuario123');
    expect(result).toEqual({ id: 'usuario123' });
  });

  it('updateProfile debe pasar los datos correctamente', async () => {
    const req = { user: { sub: 'usuario123' } };
    const updateData = { nombre: 'Nuevo' };
    mockUserService.updateProfile.mockResolvedValue({ message: 'ok' });

    const result = await controller.updateProfile(req, updateData);
    expect(mockUserService.updateProfile).toHaveBeenCalledWith('usuario123', updateData);
    expect(result).toEqual({ message: 'ok' });
  });

  it('cleanupInactiveUsers debe invocar cleanupService', async () => {
    mockCleanupService.deleteInactiveUsers.mockResolvedValue({ eliminados: 3 });

    const result = await controller.cleanupInactiveUsers();
    expect(mockCleanupService.deleteInactiveUsers).toHaveBeenCalled();
    expect(result).toEqual({ eliminados: 3 });
  });
});