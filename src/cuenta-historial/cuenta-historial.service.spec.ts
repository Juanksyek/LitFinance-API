import { Test, TestingModule } from '@nestjs/testing';
import { CuentaHistorialService } from './cuenta-historial.service';
import { getModelToken } from '@nestjs/mongoose';
import { CreateCuentaHistorialDto } from './dto/create-cuenta-historial.dto';

jest.mock('../utils/generate-id', () => ({
  generateUniqueId: jest.fn().mockResolvedValue('mockedId'),
}));

describe('CuentaHistorialService', () => {
  let service: CuentaHistorialService;
  let historialModel: any;

  const mockDto: CreateCuentaHistorialDto = {
    cuentaId: 'cuenta123',
    descripcion: 'Test movimiento',
    tipo: 'ingreso',
    monto: 500,
    conceptoId: 'concepto123',
    fecha: new Date().toISOString(),
    subcuentaId: undefined,
    userId: 'user123',
  };

  beforeEach(async () => {
    const saveMock = jest.fn().mockResolvedValue({ ...mockDto, _id: 'mockedId' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CuentaHistorialService,
        {
          provide: getModelToken('CuentaHistorial'),
          useValue: function (this: any, data: any) {
            Object.assign(this, data);
            this.save = saveMock;
          },
        },
      ],
    }).compile();

    service = module.get<CuentaHistorialService>(CuentaHistorialService);
    historialModel = module.get(getModelToken('CuentaHistorial'));

    // Simular métodos estáticos directamente sobre historialModel
    historialModel.countDocuments = jest.fn().mockResolvedValue(1);
    historialModel.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { ...mockDto, _id: '1', monto: 500 },
      ]),
    });
    historialModel.findByIdAndDelete = jest.fn().mockResolvedValue({ _id: 'testId' });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('registrarMovimiento should create and save a new historial record', async () => {
    const result = await service.registrarMovimiento(mockDto);
    expect(result._id).toBe('mockedId');
  });

  it('buscarHistorial should return paginated and enriched data', async () => {
    const result = await service.buscarHistorial('cuenta123', 1, 10, 'test');
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.data[0].detalles).toBeDefined();
  });

  it('eliminar should delete a record by id', async () => {
    const result = await service.eliminar('testId');
    expect(result).not.toBeNull();
    expect(result?._id).toBe('testId');
  });
});
