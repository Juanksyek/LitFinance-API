import { Test, TestingModule } from '@nestjs/testing';
import { CuentaController } from './cuenta.controller';

describe('CuentaController', () => {
  let controller: CuentaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CuentaController],
    }).compile();

    controller = module.get<CuentaController>(CuentaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
