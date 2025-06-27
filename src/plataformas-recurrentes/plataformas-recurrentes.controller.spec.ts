import { Test, TestingModule } from '@nestjs/testing';
import { PlataformasRecurrentesController } from './plataformas-recurrentes.controller';

describe('PlataformasRecurrentesController', () => {
  let controller: PlataformasRecurrentesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlataformasRecurrentesController],
    }).compile();

    controller = module.get<PlataformasRecurrentesController>(PlataformasRecurrentesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
