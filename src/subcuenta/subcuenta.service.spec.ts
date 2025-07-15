import { Test, TestingModule } from '@nestjs/testing';
import { SubcuentaService } from './subcuenta.service';
import { getModelToken } from '@nestjs/mongoose';
import { MonedaService } from '../moneda/moneda.service';
import { Cuenta } from '../cuenta/schemas/cuenta.schema/cuenta.schema';
import { Subcuenta } from './schemas/subcuenta.schema/subcuenta.schema';
import { SubcuentaHistorial } from './schemas/subcuenta-historial.schema/subcuenta-historial.schema';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubcuentaService,
        { provide: getModelToken(Subcuenta.name), useValue: mockModel },
        { provide: getModelToken(Cuenta.name), useValue: mockModel },
        { provide: getModelToken(SubcuentaHistorial.name), useValue: mockModel },
        { provide: MonedaService, useValue: mockMonedaService },
        { provide: CuentaHistorialService, useValue: mockCuentaHistorialService }, // Mock agregado
      ],
    }).compile();

    service = module.get<SubcuentaService>(SubcuentaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});