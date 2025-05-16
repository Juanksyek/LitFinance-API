import { Test, TestingModule } from '@nestjs/testing';
import { NotificacionesController } from './notificaciones.controller';

describe('NotificacionesController', () => {
  let controller: NotificacionesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificacionesController],
    }).compile();

    controller = module.get<NotificacionesController>(NotificacionesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
