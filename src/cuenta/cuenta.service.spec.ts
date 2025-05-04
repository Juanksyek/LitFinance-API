import { Test, TestingModule } from '@nestjs/testing';
import { CuentaService } from './cuenta.service';

describe('CuentaService', () => {
  let service: CuentaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CuentaService],
    }).compile();

    service = module.get<CuentaService>(CuentaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
