import { Test, TestingModule } from '@nestjs/testing';
import { SubcuentaController } from './subcuenta.controller';
import { SubcuentaService } from './subcuenta.service';
import { PlanConfigService } from '../plan-config/plan-config.service';

describe('SubcuentaController', () => {
  let controller: SubcuentaController;

  const mockService = {
    crear: jest.fn(),
    listar: jest.fn(),
    actualizar: jest.fn(),
    eliminar: jest.fn(),
    obtenerHistorial: jest.fn(),
    desactivar: jest.fn(),
    activar: jest.fn(),
    calcularParticipacion: jest.fn(),
  };

  const mockPlanConfigService = {
    canPerformAction: jest.fn(async () => ({ allowed: true })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubcuentaController],
      providers: [
        { provide: SubcuentaService, useValue: mockService },
        { provide: PlanConfigService, useValue: mockPlanConfigService },
      ],
    }).compile();

    controller = module.get<SubcuentaController>(SubcuentaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});