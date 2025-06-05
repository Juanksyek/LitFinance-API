import { Test, TestingModule } from '@nestjs/testing';
import { CuentaHistorialService } from './cuenta-historial.service';

describe('CuentaHistorialService', () => {
  let service: CuentaHistorialService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CuentaHistorialService],
    }).compile();

    service = module.get<CuentaHistorialService>(CuentaHistorialService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
