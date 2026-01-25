import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { getModelToken } from '@nestjs/mongoose';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
import { NotFoundException } from '@nestjs/common';
import { ConversionService } from '../utils/services/conversion.service';
import { UserService } from '../user/user.service';
import { DashboardVersionService } from '../user/services/dashboard-version.service';

describe('TransactionsService', () => {
  let service: TransactionsService;

  const mockTransactionModel = {
    findOneAndDelete: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(() => ({
      sort: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue([]),
      })),
    })),
  };

  const mockHistorialModel = {
    create: jest.fn(),
    find: jest.fn(() => ({
      sort: jest.fn(() => ({
        skip: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve([{ descripcion: 'Ejemplo' }])),
        })),
      })),
    })),
    countDocuments: jest.fn(() => Promise.resolve(1)),
  };

  const mockCuentaModel = {
    findOne: jest.fn(),
    updateOne: jest.fn(),
  };

  const mockSubcuentaModel = {
    findOne: jest.fn(),
    updateOne: jest.fn(),
  };

  const mockHistorialService = {
    registrarMovimiento: jest.fn(),
  };

  const mockConversionService = {
    convertir: jest.fn().mockResolvedValue({ montoConvertido: 100 }),
  };

  const mockUserService = {
    findById: jest.fn(),
    getProfile: jest.fn().mockResolvedValue({ monedaPrincipal: 'MXN' }),
  };

  const mockDashboardVersionService = {
    touchDashboard: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: getModelToken('Transaction'), useValue: mockTransactionModel },
        { provide: getModelToken('SubcuentaHistorial'), useValue: mockHistorialModel },
        { provide: getModelToken('Cuenta'), useValue: mockCuentaModel },
        { provide: getModelToken('Subcuenta'), useValue: mockSubcuentaModel },
        { provide: CuentaHistorialService, useValue: mockHistorialService },
        { provide: ConversionService, useValue: mockConversionService },
        { provide: UserService, useValue: mockUserService },
        { provide: DashboardVersionService, useValue: mockDashboardVersionService },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('debe eliminar una transacción correctamente', async () => {
    mockTransactionModel.findOneAndDelete.mockResolvedValueOnce({
      transaccionId: 'ABC123',
      userId: 'user1',
      subCuentaId: null,
      concepto: 'x',
      monto: 100,
    });

    const result = await service.eliminar('ABC123', 'user1');

    expect(result).toEqual({ message: 'Transacción eliminada correctamente' });
    expect(mockHistorialModel.create).toHaveBeenCalled();
  });

  it('debe lanzar error si no encuentra transacción al eliminar', async () => {
    mockTransactionModel.findOneAndDelete.mockResolvedValueOnce(null);

    await expect(service.eliminar('NOEXISTE', 'user')).rejects.toThrow(NotFoundException);
  });

  it('debe listar historial con paginación', async () => {
    mockHistorialModel.countDocuments.mockResolvedValueOnce(1);

    const result = await service.obtenerHistorial({
      subCuentaId: 'sub1',
      desde: '2023-01-01',
      hasta: '2023-12-31',
      limite: 10,
      pagina: 1,
      descripcion: 'Ejemplo',
    });

    expect(result.totalPaginas).toBe(1);
    expect(result.resultados.length).toBeGreaterThanOrEqual(0);
  });

  it('debe listar transacciones por rango', async () => {
    const mockSort = jest.fn().mockResolvedValue([]);
    mockTransactionModel.find = jest.fn().mockReturnValueOnce({ sort: mockSort });

    const result = await service.listar('user1', 'mes');

    expect(Array.isArray(result)).toBe(true);
    expect(mockTransactionModel.find).toHaveBeenCalled();
  });
});