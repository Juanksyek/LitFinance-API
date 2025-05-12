import { Test, TestingModule } from '@nestjs/testing';
import { SubcuentaController } from './subcuenta.controller';

describe('SubcuentaController', () => {
  let controller: SubcuentaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubcuentaController],
    }).compile();

    controller = module.get<SubcuentaController>(SubcuentaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
