import { Test, TestingModule } from '@nestjs/testing';
import { NotificacionesService } from './notificaciones.service';

describe('NotificacionesService', () => {
  let service: NotificacionesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificacionesService],
    }).compile();

    service = module.get<NotificacionesService>(NotificacionesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
