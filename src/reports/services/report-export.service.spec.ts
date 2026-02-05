import { Test, TestingModule } from '@nestjs/testing';
import { ReportExportService } from './report-export.service';
import { AnalyticsService } from '../../analytics/analytics.service';
import { UserService } from '../../user/user.service';

describe('ReportExportService', () => {
  let service: ReportExportService;

  const mockAnalyticsService = {
    obtenerResumenInteligente: jest.fn(),
    compararPeriodos: jest.fn(),
    obtenerMovimientosDetallados: jest.fn(),
  };

  const mockUserService = {
    getProfile: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportExportService,
        { provide: AnalyticsService, useValue: mockAnalyticsService },
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile();

    service = module.get<ReportExportService>(ReportExportService);

    jest.clearAllMocks();

    mockUserService.getProfile.mockResolvedValue({
      nombreCompleto: 'Carlos',
      email: 'carlos@example.com',
      monedaPrincipal: 'MXN',
    });

    mockAnalyticsService.obtenerResumenInteligente.mockResolvedValue({
      periodo: {
        fechaInicio: new Date('2026-01-01T00:00:00.000Z'),
        fechaFin: new Date('2026-01-31T23:59:59.999Z'),
        descripcion: 'mes',
      },
      moneda: 'MXN',
      totales: {
        ingresos: 1000,
        gastos: 400,
        balance: 600,
        movimientos: 3,
      },
      serieMensual: [
        { mes: '2026-01', ingresos: 1000, gastos: 400, balance: 600, movimientos: 3 },
      ],
      topConceptosGasto: [
        { concepto: 'Comida', total: 200, porcentaje: 50, movimientos: 2 },
      ],
      recurrentes: [
        { nombre: 'Netflix', total: 100, porcentaje: 25, cargos: 1 },
      ],
      insights: [
        {
          prioridad: 'alta',
          titulo: 'Gasto alto',
          descripcion: 'Tus gastos subieron vs el periodo anterior.',
          accionSugerida: 'Revisa gastos variables.',
        },
      ],
    });

    mockAnalyticsService.compararPeriodos.mockResolvedValue({
      cambios: {
        ingresos: { absoluto: 100, porcentual: 10 },
        gastos: { absoluto: 50, porcentual: 12.5 },
        balance: { absoluto: 50, porcentual: 9.1 },
        movimientos: { absoluto: 1, porcentual: 50 },
      },
    });

    mockAnalyticsService.obtenerMovimientosDetallados.mockResolvedValue({
      movimientos: [
        {
          id: 'T1',
          tipo: 'ingreso',
          fecha: new Date('2026-01-10T12:00:00.000Z'),
          monto: 1000,
          moneda: 'MXN',
          descripcion: 'Sueldo',
          concepto: { id: 'c1', nombre: 'Sueldo' },
          subcuenta: undefined,
        },
      ],
      paginacion: {
        paginaActual: 1,
        totalPaginas: 1,
        totalElementos: 1,
        elementosPorPagina: 5000,
      },
    });
  });

  it('exporta PDF como base64', async () => {
    const res = await service.exportar('user1', { format: 'pdf' } as any);
    expect(res.mimeType).toBe('application/pdf');
    expect(res.filename.endsWith('.pdf')).toBe(true);

    const buf = Buffer.from(res.base64, 'base64');
    expect(buf.slice(0, 4).toString('utf8')).toBe('%PDF');
  });

  it('exporta XLSX como base64', async () => {
    const res = await service.exportar('user1', { format: 'xlsx' } as any);
    expect(res.mimeType).toContain('spreadsheetml');
    expect(res.filename.endsWith('.xlsx')).toBe(true);

    const buf = Buffer.from(res.base64, 'base64');
    // XLSX es ZIP
    expect(buf.slice(0, 2).toString('utf8')).toBe('PK');
  });
});
