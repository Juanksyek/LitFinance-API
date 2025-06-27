import { Test, TestingModule } from '@nestjs/testing';
import { PlataformasRecurrentesService } from './plataformas-recurrentes.service';

describe('PlataformasRecurrentesService', () => {
  let service: PlataformasRecurrentesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PlataformasRecurrentesService],
    }).compile();

    service = module.get<PlataformasRecurrentesService>(PlataformasRecurrentesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
