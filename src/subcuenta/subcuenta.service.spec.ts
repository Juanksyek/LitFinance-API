import { Test, TestingModule } from '@nestjs/testing';
import { SubcuentaService } from './subcuenta.service';

describe('SubcuentaService', () => {
  let service: SubcuentaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SubcuentaService],
    }).compile();

    service = module.get<SubcuentaService>(SubcuentaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
