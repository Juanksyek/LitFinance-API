import { Test, TestingModule } from '@nestjs/testing';
import { CuentaHistorialController } from './cuenta-historial.controller';

describe('CuentaHistorialController', () => {
  let controller: CuentaHistorialController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CuentaHistorialController],
    }).compile();

    controller = module.get<CuentaHistorialController>(CuentaHistorialController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
