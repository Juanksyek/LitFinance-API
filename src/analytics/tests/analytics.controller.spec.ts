import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from '../analytics.controller';
import { AnalyticsService } from '../analytics.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: AnalyticsService;

  const mockAnalyticsService = {
    obtenerResumenFinanciero: jest.fn(),
    obtenerEstadisticasPorConcepto: jest.fn(),
    obtenerEstadisticasPorSubcuenta: jest.fn(),
    obtenerEstadisticasPorRecurrente: jest.fn(),
    obtenerAnalisisTemporal: jest.fn(),
    obtenerMovimientosDetallados: jest.fn(),
    compararPeriodos: jest.fn(),
  };

  const mockJwtAuthGuard = {
    canActivate: jest.fn(() => true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        {
          provide: AnalyticsService,
          useValue: mockAnalyticsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    service = module.get<AnalyticsService>(AnalyticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('obtenerResumenFinanciero', () => {
    it('should return financial summary', async () => {
      const mockRequest = { user: { id: 'user123' } };
      const mockFiltros = { rangoTiempo: 'mes' as const };
      const mockResponse = {
        totalIngresado: { monto: 5000, moneda: 'USD', desglosePorMoneda: [] },
        totalGastado: { monto: 3000, moneda: 'USD', desglosePorMoneda: [] },
        balance: { monto: 2000, moneda: 'USD', esPositivo: true },
        totalEnSubcuentas: { monto: 1000, moneda: 'USD', desglosePorSubcuenta: [] },
        totalMovimientos: 50,
        periodo: {
          fechaInicio: new Date('2024-01-01'),
          fechaFin: new Date('2024-01-31'),
          descripcion: 'Último mes'
        }
      };

      mockAnalyticsService.obtenerResumenFinanciero.mockResolvedValue(mockResponse);

      const result = await controller.obtenerResumenFinanciero(mockRequest, mockFiltros);

      expect(result).toEqual(mockResponse);
      expect(mockAnalyticsService.obtenerResumenFinanciero).toHaveBeenCalledWith('user123', mockFiltros);
    });
  });

  describe('obtenerEstadisticasPorConcepto', () => {
    it('should return statistics by concept', async () => {
      const mockRequest = { user: { id: 'user123' } };
      const mockFiltros = { rangoTiempo: 'mes' as const };
      const mockResponse = [
        {
          concepto: {
            id: 'concepto123',
            nombre: 'Alimentación',
            color: '#ff6b6b'
          },
          totalIngreso: 100,
          totalGasto: 500,
          cantidadMovimientos: 20,
          montoPromedio: 30,
          ultimoMovimiento: new Date('2024-01-30'),
          participacionPorcentual: 25
        }
      ];

      mockAnalyticsService.obtenerEstadisticasPorConcepto.mockResolvedValue(mockResponse);

      const result = await controller.obtenerEstadisticasPorConcepto(mockRequest, mockFiltros);

      expect(result).toEqual(mockResponse);
      expect(mockAnalyticsService.obtenerEstadisticasPorConcepto).toHaveBeenCalledWith('user123', mockFiltros);
    });
  });

  describe('obtenerTotalesRapidos', () => {
    it('should return quick totals', async () => {
      const mockRequest = { user: { sub: 'user123' } };
      const mockFiltros = { rangoTiempo: 'mes' as const };
      const mockResumen = {
        totalIngresado: { monto: 5000, moneda: 'USD', desglosePorMoneda: [] },
        totalGastado: { monto: 3000, moneda: 'USD', desglosePorMoneda: [] },
        balance: { monto: 2000, moneda: 'USD', esPositivo: true },
        totalEnSubcuentas: { monto: 1000, moneda: 'USD', desglosePorSubcuenta: [] },
        totalMovimientos: 50,
        periodo: {
          fechaInicio: new Date('2024-01-01'),
          fechaFin: new Date('2024-01-31'),
          descripcion: 'Último mes'
        }
      };

      mockAnalyticsService.obtenerResumenFinanciero.mockResolvedValue(mockResumen);

      const result = await controller.obtenerTotalesRapidos(mockRequest, mockFiltros);

      expect(result).toEqual({
        totalIngresado: 5000,
        totalGastado: 3000,
        balance: 2000,
        totalSubcuentas: 1000,
        totalMovimientos: 50,
        moneda: 'USD'
      });
    });
  });

  describe('obtenerTopGastos', () => {
    it('should return top expenses', async () => {
      const mockRequest = { user: { sub: 'user123' } };
      const mockFiltros = { rangoTiempo: 'mes' as const };
      const mockEstadisticas = [
        {
          concepto: {
            id: 'concepto123',
            nombre: 'Alimentación',
            color: '#ff6b6b'
          },
          totalIngreso: 0,
          totalGasto: 500,
          cantidadMovimientos: 20,
          montoPromedio: 25,
          ultimoMovimiento: new Date('2024-01-30'),
          participacionPorcentual: 50
        },
        {
          concepto: {
            id: 'concepto456',
            nombre: 'Transporte',
            color: '#4ecdc4'
          },
          totalIngreso: 0,
          totalGasto: 300,
          cantidadMovimientos: 15,
          montoPromedio: 20,
          ultimoMovimiento: new Date('2024-01-29'),
          participacionPorcentual: 30
        }
      ];

      mockAnalyticsService.obtenerEstadisticasPorConcepto.mockResolvedValue(mockEstadisticas);

      const result = await controller.obtenerTopGastos(mockRequest, mockFiltros, 5);

      expect(result).toEqual([
        {
          concepto: 'concepto123',
          nombre: 'Alimentación',
          monto: 500,
          cantidadMovimientos: 20,
          color: '#ff6b6b'
        },
        {
          concepto: 'concepto456',
          nombre: 'Transporte',
          monto: 300,
          cantidadMovimientos: 15,
          color: '#4ecdc4'
        }
      ]);
    });
  });
});
