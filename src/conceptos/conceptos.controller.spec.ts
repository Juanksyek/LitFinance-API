import { Test, TestingModule } from '@nestjs/testing';
import { ConceptosController } from './conceptos.controller';
import { ConceptosService } from './conceptos.service';
import { SearchProtectionService } from '../common/services/search-protection.service';

describe('ConceptosController', () => {
  let controller: ConceptosController;

  const mockConceptosService = {
    listar: jest.fn(),
    crear: jest.fn(),
    actualizar: jest.fn(),
    eliminar: jest.fn(),
  };

  const mockSearchProtectionService = {
    guard: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConceptosController],
      providers: [
        { provide: ConceptosService, useValue: mockConceptosService },
        {
          provide: SearchProtectionService,
          useValue: mockSearchProtectionService,
        },
      ],
    }).compile();

    controller = module.get<ConceptosController>(ConceptosController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
