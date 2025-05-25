import { Test, TestingModule } from '@nestjs/testing';
import { RecurrentesService } from './recurrentes.service';
import { getModelToken } from '@nestjs/mongoose';
import { NotificacionesService } from '../notificaciones/notificaciones.service';

describe('RecurrentesService', () => {
  let service: RecurrentesService;
  let recurrenteModel: any;
  let historialModel: any;
  let notificacionesService: any;

  beforeEach(async () => {
    recurrenteModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      deleteOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    historialModel = { create: jest.fn() };
    notificacionesService = { enviarNotificacionPush: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurrentesService,
        { provide: getModelToken('Recurrente'), useValue: recurrenteModel },
        { provide: getModelToken('HistorialRecurrente'), useValue: historialModel },
        { provide: NotificacionesService, useValue: notificacionesService },
      ],
    }).compile();

    service = module.get<RecurrentesService>(RecurrentesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('debería lanzar excepción si no se encuentra el recurrente', async () => {
    recurrenteModel.findOne.mockResolvedValue(null);
    await expect(service.obtenerPorId('fakeId')).rejects.toThrow('Recurrente no encontrado');
  });

  it('debería eliminar un recurrente correctamente', async () => {
    recurrenteModel.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const res = await service.eliminar('r123');
    expect(res).toEqual({
      eliminado: true,
      mensaje: 'El recurrente con ID r123 fue eliminado correctamente.',
    });
  });

  it('debería listar los recurrentes del usuario', async () => {
    const mockResult = [{ nombre: 'Spotify' }];
    recurrenteModel.find.mockReturnValue({ sort: () => ({ exec: () => mockResult }) });

    const result = await service.listar('user123');
    expect(result).toEqual(mockResult);
  });

  it('debería calcular próxima ejecución correctamente', () => {
    const today = new Date('2025-01-01');
    const expected = new Date('2025-01-11');
    const result = service.calcularProximaFecha(today, 10);
    expect(result.toDateString()).toBe(expected.toDateString());
  });
});