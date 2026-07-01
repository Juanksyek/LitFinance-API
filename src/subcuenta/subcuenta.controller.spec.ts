import { Test, TestingModule } from '@nestjs/testing';
import { SubcuentaController } from './subcuenta.controller';
import { SubcuentaService } from './subcuenta.service';
import { PlanConfigService } from '../plan-config/plan-config.service';

describe('SubcuentaController', () => {
  let controller: SubcuentaController;

  const mockService = {
    crear: jest.fn(),
    listar: jest.fn(),
    buscarPorSubCuentaId: jest.fn(),
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

  it('listar debe usar el userId autenticado', async () => {
    const req = { user: { id: 'user-token' } };

    await controller.listarPorUserId(req as any, 'otro-user', undefined, undefined, 1, 4, undefined);

    expect(mockService.listar).toHaveBeenCalledWith('user-token', undefined, undefined, 1, 4, true);
  });

  it('buscarPorSubCuentaId debe filtrar por el userId autenticado', async () => {
    const req = { user: { id: 'user-token' } };

    await controller.buscarPorSubCuentaId(req as any, 'sub-1');

    expect(mockService.buscarPorSubCuentaId).toHaveBeenCalledWith('sub-1', 'user-token');
  });
});
