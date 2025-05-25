import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { getModelToken } from '@nestjs/mongoose';
import { Transaction } from './schemas/transaction.schema/transaction.schema';
import { SubcuentaHistorial } from '../subcuenta/schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { Cuenta } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta } from '../subcuenta/schemas/subcuenta.schema/subcuenta.schema';

describe('TransactionsService', () => {
  let service: TransactionsService;

  const mockModel = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
    updateOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: getModelToken(Transaction.name), useValue: { ...mockModel, save: jest.fn() } },
        { provide: getModelToken(SubcuentaHistorial.name), useValue: mockModel },
        { provide: getModelToken(Cuenta.name), useValue: mockModel },
        { provide: getModelToken(Subcuenta.name), useValue: mockModel },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('listar() debe devolver una lista de transacciones', async () => {
    const mockTransacciones = [{ concepto: 'Pago', monto: 100 }];
    mockModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(mockTransacciones) });

    const result = await service.listar('usuario123');
    expect(result).toEqual(mockTransacciones);
    expect(mockModel.find).toHaveBeenCalledWith({ userId: 'usuario123' });
  });

  it('buscar() debe aplicar filtros correctamente', async () => {
    const mockFiltro = { concepto: 'gas', motivo: 'comida', monto: 200 };

    mockModel.find.mockReturnValue({
      sort: jest.fn().mockResolvedValue([]),
    });

    const result = await service.buscar('usuario123', mockFiltro);
    expect(mockModel.find).toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
