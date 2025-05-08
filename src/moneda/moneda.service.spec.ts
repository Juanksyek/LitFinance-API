import { Test, TestingModule } from '@nestjs/testing';
import { MonedaService } from './moneda.service';

describe('MonedaService', () => {
  let service: MonedaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MonedaService],
    }).compile();

    service = module.get<MonedaService>(MonedaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
