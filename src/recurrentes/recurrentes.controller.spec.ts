import { Test, TestingModule } from '@nestjs/testing';
import { RecurrentesController } from './recurrentes.controller';
import { RecurrentesService } from './recurrentes.service';
import { CrearRecurrenteDto, PlataformaDto } from './dto/crear-recurrente.dto';

describe('RecurrentesController', () => {
  let controller: RecurrentesController;
  let service: RecurrentesService;

  beforeEach(async () => {
    const mockService = {
      crear: jest.fn(),
      listar: jest.fn(),
      obtenerPorId: jest.fn(),
      editar: jest.fn(),
      eliminar: jest.fn(),
      ejecutarRecurrentesDelDia: jest.fn().mockResolvedValue(3),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecurrentesController],
      providers: [{ provide: RecurrentesService, useValue: mockService }],
    }).compile();

    controller = module.get<RecurrentesController>(RecurrentesController);
    service = module.get<RecurrentesService>(RecurrentesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('debe llamar crear del servicio', async () => {
    const dto: CrearRecurrenteDto = {
      nombre: 'Spotify',
      frecuenciaDias: 30,
      monto: 100,
      cuentaId: 'cuenta1',
      subcuentaId: 'sub1',
      afectaCuentaPrincipal: true,
      afectaSubcuenta: false,
      userId: 'user123',
      recordatorios: [1, 3],
      plataforma: { nombre: 'Spotify' } as PlataformaDto,
    };

    await controller.crear({ user: { sub: 'user123' } } as any, dto);
    expect(service.crear).toHaveBeenCalledWith(dto, 'user123');
  });

  it('debe llamar listar del servicio', async () => {
    await controller.listar({ user: { sub: 'user123' } } as any);
    expect(service.listar).toHaveBeenCalledWith('user123');
  });

  it('debe llamar editar del servicio', async () => {
    await controller.editar('rec123', { nombre: 'Nuevo' } as any);
    expect(service.editar).toHaveBeenCalledWith('rec123', { nombre: 'Nuevo' });
  });

  it('debe llamar ejecutarHoy del servicio', async () => {
    const result = await controller.ejecutarHoy();
    expect(result).toEqual({ ejecutados: 3 });
  });
});