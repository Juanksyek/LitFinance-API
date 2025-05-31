import { Test, TestingModule } from '@nestjs/testing';
import { ConceptosController } from './conceptos.controller';

describe('ConceptosController', () => {
  let controller: ConceptosController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConceptosController],
    }).compile();

    controller = module.get<ConceptosController>(ConceptosController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
