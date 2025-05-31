import { Test, TestingModule } from '@nestjs/testing';
import { ConceptosService } from './conceptos.service';

describe('ConceptosService', () => {
  let service: ConceptosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConceptosService],
    }).compile();

    service = module.get<ConceptosService>(ConceptosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
