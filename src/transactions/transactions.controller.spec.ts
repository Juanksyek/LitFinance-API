import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

describe('TransactionsController', () => {
  let controller: TransactionsController;

  const mockService = {
    crear: jest.fn(),
    editar: jest.fn(),
    eliminar: jest.fn(),
    listar: jest.fn(),
    buscar: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        { provide: TransactionsService, useValue: mockService },
      ],
    }).compile();

    controller = module.get<TransactionsController>(TransactionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('listar() debe invocar al servicio con userId', async () => {
    const mockReq = { user: { sub: 'usuario123' } };
    mockService.listar.mockResolvedValue(['mock']);

    const result = await controller.listar(mockReq);
    expect(result).toEqual(['mock']);
    expect(mockService.listar).toHaveBeenCalledWith('usuario123');
  });

  it('buscar() debe pasar los filtros correctamente', async () => {
    const mockReq = { user: { sub: 'usuario123' } };
    const filtros = { concepto: 'Netflix', motivo: 'entretenimiento', monto: 150 };

    await controller.buscar(mockReq, filtros.concepto, filtros.motivo, filtros.monto);
    expect(mockService.buscar).toHaveBeenCalledWith('usuario123', filtros);
  });
});