import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { PlanConfigService } from './plan-config.service';

describe('PlanConfigService (reportesExportables)', () => {
  let service: PlanConfigService;

  const makeModel = (planDoc: any) => ({
    findOne: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(planDoc),
    })),
    find: jest.fn(() => ({ exec: jest.fn().mockResolvedValue([]) })),
    findOneAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(planDoc) })),
    deleteOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) })),
  });

  it('permite reportes si plan es premium y el flag aún no existe (undefined)', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanConfigService,
        {
          provide: getModelToken('PlanConfig'),
          useValue: makeModel({
            planType: 'premium_plan',
            activo: true,
            // reportesExportables intentionally missing
          }),
        },
      ],
    }).compile();

    service = module.get(PlanConfigService);

    const res = await service.canPerformAction('u1', 'premium_plan', 'reporte');
    expect(res.allowed).toBe(true);
  });

  it('bloquea reportes si plan no es premium y el flag aún no existe (undefined)', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanConfigService,
        {
          provide: getModelToken('PlanConfig'),
          useValue: makeModel({
            planType: 'free_plan',
            activo: true,
            // reportesExportables intentionally missing
          }),
        },
      ],
    }).compile();

    service = module.get(PlanConfigService);

    const res = await service.canPerformAction('u1', 'free_plan', 'reporte');
    expect(res.allowed).toBe(false);
  });
});
