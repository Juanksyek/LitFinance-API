import { Test, TestingModule } from '@nestjs/testing';
import { RecurrentesService } from './recurrentes.service';

describe('RecurrentesService', () => {
  let service: RecurrentesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RecurrentesService],
    }).compile();

    service = module.get<RecurrentesService>(RecurrentesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
