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
    findOne: jest.fn().mockResolvedValue(null),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    find: jest.fn(() => ({
      sort: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue([]),
      })),
    })),
  };

  const mockHistorialModel = {
    create: jest.fn(),
    findOne: jest.fn(),
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
    upsertMovimientoTransaccion: jest.fn(),
    marcarTransaccionEliminada: jest.fn(),
    findMovimientoById: jest.fn(),
    marcarMovimientoEliminadoById: jest.fn(),
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
    mockTransactionModel.findOne.mockResolvedValueOnce({
      transaccionId: 'ABC123',
      userId: 'user1',
      subCuentaId: null,
      concepto: 'x',
      monto: 100,
      tipo: 'ingreso',
      afectaCuenta: false,
      toObject: function () { return this; },
    });
    mockTransactionModel.deleteOne.mockResolvedValueOnce({ deletedCount: 1 });

    const result = await service.eliminar('ABC123', 'user1');

    expect(result).toEqual({ message: 'Transacción eliminada correctamente' });
    expect(mockHistorialModel.create).toHaveBeenCalled();
  });

  it('debe lanzar error si no encuentra transacción al eliminar', async () => {
    mockTransactionModel.findOne.mockResolvedValueOnce(null);

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

  it('eliminarMovimiento debe restaurar balance en modo fallback si la transacción no existe', async () => {
    const movimientoId = 'IiiC8y2';

    // movimiento del historial asociado a una transacción inexistente
    mockHistorialService.findMovimientoById = jest.fn().mockResolvedValue({
      id: movimientoId,
      userId: 'user1',
      cuentaId: 'c1',
      subcuentaId: undefined,
      monto: -400,
      metadata: {
        audit: { transaccionId: 'u5sstYz' },
      },
    });
    mockHistorialService.marcarMovimientoEliminadoById = jest.fn().mockResolvedValue({ id: movimientoId });

    // eliminar() intenta buscar transacción y falla
    mockTransactionModel.findOne.mockResolvedValueOnce(null);

    // fallback: restaurar cuenta
    mockCuentaModel.findOne.mockResolvedValueOnce({ id: 'c1', userId: 'user1', cantidad: 1000 });
    mockCuentaModel.updateOne.mockResolvedValueOnce({ acknowledged: true });

    const res = await service.eliminarMovimiento(movimientoId, 'user1');

    expect(res).toEqual(
      expect.objectContaining({
        message: 'Movimiento eliminado correctamente',
        mode: 'fallback',
      }),
    );
    expect(mockCuentaModel.updateOne).toHaveBeenCalledWith(
      { id: 'c1', userId: 'user1' },
      { $inc: { cantidad: 400 } },
    );
    expect(mockHistorialService.marcarMovimientoEliminadoById).toHaveBeenCalled();
  });

  it('editar acepta `transaccionId` como identificador', async () => {
    const actual = {
      transaccionId: 'ABC123',
      userId: 'user1',
      monto: 100,
      tipo: 'ingreso',
      afectaCuenta: false,
      registradoEn: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      toObject() { return this; },
    } as any;

    mockTransactionModel.findOne.mockResolvedValueOnce(actual);
    // findOneAndUpdate should return the updated document
    const updated = { ...actual, monto: 200 };
    mockTransactionModel.findOneAndUpdate.mockResolvedValueOnce(updated);

    // stub aplicarBalances to avoid deep model interactions
    (service as any).aplicarBalances = jest.fn().mockResolvedValue({ cuentaId: 'c1', cuentaDelta: 100, metadata: {} });

    const res = await service.editar('ABC123', { monto: 200 } as any, 'user1');

    expect(res.transaccion).toBeDefined();
    expect(res.transaccion.monto).toBe(200);
    expect(mockTransactionModel.findOne).toHaveBeenCalled();
    expect(mockTransactionModel.findOneAndUpdate).toHaveBeenCalled();
  });

  it('editar acepta Mongo `_id` como identificador (fallback)', async () => {
    const mongoId = '507f1f77bcf86cd799439011';

    const actualNull = null;
    const actualById = {
      _id: mongoId,
      transaccionId: 'XYZ999',
      userId: 'user2',
      monto: 50,
      tipo: 'egreso',
      afectaCuenta: false,
      registradoEn: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      toObject() { return this; },
    } as any;

    // First call (transaccionId lookup) returns null, second call (by _id) returns the doc
    mockTransactionModel.findOne.mockResolvedValueOnce(actualNull).mockResolvedValueOnce(actualById);
    const updated = { ...actualById, monto: 75 };
    mockTransactionModel.findOneAndUpdate.mockResolvedValueOnce(updated);

    (service as any).aplicarBalances = jest.fn().mockResolvedValue({ cuentaId: 'c2', cuentaDelta: -25, metadata: {} });

    const res = await service.editar(mongoId, { monto: 75 } as any, 'user2');

    expect(res.transaccion).toBeDefined();
    expect(res.transaccion.monto).toBe(75);
    expect(mockTransactionModel.findOne).toHaveBeenCalledTimes(2);
    expect(mockTransactionModel.findOneAndUpdate).toHaveBeenCalled();
  });
});