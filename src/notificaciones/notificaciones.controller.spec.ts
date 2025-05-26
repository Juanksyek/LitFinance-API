import { Test, TestingModule } from '@nestjs/testing';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesService } from './notificaciones.service';

describe('NotificacionesController', () => {
  let controller: NotificacionesController;
  let mockService: NotificacionesService;

  beforeEach(async () => {
    const mockServiceProvider = {
      provide: NotificacionesService,
      useValue: {
        registrarToken: jest.fn().mockResolvedValue({ registrado: true }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificacionesController],
      providers: [mockServiceProvider],
    }).compile();

    controller = module.get<NotificacionesController>(NotificacionesController);
    mockService = module.get<NotificacionesService>(NotificacionesService);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
  });

  it('debe registrar un token con los datos del body', async () => {
    const body: {
      userId: string;
      token: string;
      plataforma: 'android' | 'web' | 'ios';
      appVersion?: string;
    } = {
      userId: 'user123',
      token: 'tok_abc',
      plataforma: 'android',
    };

    const result = await controller.registrar(body);
    expect(mockService.registrarToken).toHaveBeenCalledWith('user123', 'tok_abc', 'android', undefined);
    expect(result).toEqual({ registrado: true });
  });
});
