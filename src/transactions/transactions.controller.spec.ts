import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

describe('TransactionsController', () => {
  let controller: TransactionsController;
  let mockService: any;

  beforeEach(async () => {
    mockService = {
      eliminar: jest.fn(),
      listar: jest.fn(),
      obtenerHistorial: jest.fn(),
    };

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

  it('listar() debe invocar al servicio con userId y rango', async () => {
    const mockReq = { user: { id: 'usuario123' } };
    const rango = '2023-01-01_2023-01-31';
    mockService.listar.mockResolvedValue(['mock']);

    const result = await controller.listar(mockReq, rango, undefined, undefined, undefined, undefined);
    expect(result).toEqual(['mock']);
    expect(mockService.listar).toHaveBeenCalledWith('usuario123', {
      rango,
      fechaInicio: undefined,
      fechaFin: undefined,
      moneda: undefined,
      withTotals: false,
    });
  });

  it('eliminar() debe invocar al servicio con id y userId', async () => {
    const mockReq = { user: { id: 'usuario123' } };
    const id = 'transaccion123';
    mockService.eliminar.mockResolvedValue({ message: 'Transacción eliminada' });

    const result = await controller.eliminar(id, mockReq);
    expect(result).toEqual({ message: 'Transacción eliminada' });
    expect(mockService.eliminar).toHaveBeenCalledWith(id, 'usuario123');
  });

  it('historialSubcuenta() debe invocar al servicio con los parámetros correctos', async () => {
    const subCuentaId = 'subcuenta123';
    const mockReq = { user: { sub: 'usuario123' } };
    const queryParams = {
      desde: '2023-01-01',
      hasta: '2023-01-31',
      limite: 10,
      pagina: 2,
      descripcion: 'test',
    };

    mockService.obtenerHistorial.mockResolvedValue(['mockHistorial']);

    const result = await controller.historialSubcuenta(
      subCuentaId,
      queryParams.desde,
      queryParams.hasta,
      queryParams.limite,
      queryParams.pagina,
      queryParams.descripcion,
    );

    expect(result).toEqual(['mockHistorial']);
    expect(mockService.obtenerHistorial).toHaveBeenCalledWith({
      subCuentaId,
      desde: queryParams.desde,
      hasta: queryParams.hasta,
      limite: queryParams.limite,
      pagina: queryParams.pagina,
      descripcion: queryParams.descripcion,
    });
  });
});