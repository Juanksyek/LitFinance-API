import { Test, TestingModule } from '@nestjs/testing';
import { ConceptosService } from './conceptos.service';
import { getModelToken } from '@nestjs/mongoose';

describe('ConceptosService', () => {
  let service: ConceptosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConceptosService,
        {
          provide: getModelToken('ConceptoPersonalizado'),
          useValue: {
            find: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ConceptosService>(ConceptosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
