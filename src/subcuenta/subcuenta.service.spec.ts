import { Test, TestingModule } from '@nestjs/testing';
import { SubcuentaService } from './subcuenta.service';
import { getModelToken } from '@nestjs/mongoose';
import { MonedaService } from '../moneda/moneda.service';
import { Cuenta } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta } from './schemas/subcuenta.schema/subcuenta.schema';
import { SubcuentaHistorial } from './schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
import { Transaction } from '../transactions/schemas/transaction.schema/transaction.schema';
import { HistorialRecurrente } from '../recurrentes/schemas/historial-recurrente.schema';
import { ConversionService } from '../utils/services/conversion.service';
import { UserService } from '../user/user.service';
import { PlanConfigService } from '../plan-config/plan-config.service';
import { DashboardVersionService } from '../user/services/dashboard-version.service';

describe('SubcuentaService', () => {
  let service: SubcuentaService;

  const mockModel = {
    findOne: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    deleteOne: jest.fn(),
  };

  const mockMonedaService = {
    obtenerTasaCambio: jest.fn().mockResolvedValue({ tasa: 1 }),
  };

  const mockCuentaHistorialService = {
    registrarMovimiento: jest.fn(),
  };

  const mockConversionService = {
    convertir: jest.fn().mockResolvedValue({ montoConvertido: 100 }),
  };

  const mockUserService = {
    findById: jest.fn(),
    getProfile: jest.fn().mockResolvedValue({ monedaPrincipal: 'MXN' }),
  };

  const mockPlanConfigService = {
    findByPlanType: jest.fn().mockResolvedValue({ limits: { subcuentasPorUsuario: -1 } }),
  };

  const mockDashboardVersionService = {
    touchDashboard: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubcuentaService,
        { provide: getModelToken(Subcuenta.name), useValue: mockModel },
        { provide: getModelToken(Cuenta.name), useValue: mockModel },
        { provide: getModelToken(SubcuentaHistorial.name), useValue: mockModel },
        { provide: getModelToken(Transaction.name), useValue: mockModel },
        { provide: getModelToken(HistorialRecurrente.name), useValue: mockModel },
        { provide: MonedaService, useValue: mockMonedaService },
        { provide: CuentaHistorialService, useValue: mockCuentaHistorialService },
        { provide: ConversionService, useValue: mockConversionService },
        { provide: UserService, useValue: mockUserService },
        { provide: PlanConfigService, useValue: mockPlanConfigService },
        { provide: DashboardVersionService, useValue: mockDashboardVersionService },
      ],
    }).compile();

    service = module.get<SubcuentaService>(SubcuentaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});