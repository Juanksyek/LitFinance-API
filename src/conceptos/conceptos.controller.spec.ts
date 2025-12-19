import { Test, TestingModule } from '@nestjs/testing';
import { ConceptosController } from './conceptos.controller';
import { ConceptosService } from './conceptos.service';

describe('ConceptosController', () => {
  let controller: ConceptosController;

  const mockConceptosService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConceptosController],
      providers: [
        { provide: ConceptosService, useValue: mockConceptosService },
      ],
    }).compile();

    controller = module.get<ConceptosController>(ConceptosController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
