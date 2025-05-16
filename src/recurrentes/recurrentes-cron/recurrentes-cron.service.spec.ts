import { Test, TestingModule } from '@nestjs/testing';
import { RecurrentesCronService } from './recurrentes-cron.service';

describe('RecurrentesCronService', () => {
  let service: RecurrentesCronService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RecurrentesCronService],
    }).compile();

    service = module.get<RecurrentesCronService>(RecurrentesCronService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
