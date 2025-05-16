import { Test, TestingModule } from '@nestjs/testing';
import { RecurrentesController } from './recurrentes.controller';

describe('RecurrentesController', () => {
  let controller: RecurrentesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecurrentesController],
    }).compile();

    controller = module.get<RecurrentesController>(RecurrentesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
