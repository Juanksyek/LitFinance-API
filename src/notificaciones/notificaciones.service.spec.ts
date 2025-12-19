import { Test, TestingModule } from '@nestjs/testing';
import { NotificacionesService } from './notificaciones.service';
import { getModelToken } from '@nestjs/mongoose';
import { DispositivoUsuario } from './schemas/dispositivo-usuario.schema';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('NotificacionesService', () => {
  let service: NotificacionesService;
  let mockModel: any;

  beforeEach(async () => {
    mockModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificacionesService,
        {
          provide: getModelToken(DispositivoUsuario.name),
          useValue: mockModel,
        },        {
          provide: getModelToken('User'),
          useValue: {
            find: jest.fn(),
            findById: jest.fn(),
          },
        },      ],
    }).compile();

    service = module.get<NotificacionesService>(NotificacionesService);
    process.env.ONESIGNAL_APP_ID = 'fake-app-id';
    process.env.ONESIGNAL_API_KEY = 'fake-api-key';
    process.env.ONESIGNAL_API_URL = 'https://fake.onesignal.com/api/v1/notifications';
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe registrar un token si no existe', async () => {
    mockModel.findOne.mockResolvedValue(null);
    mockModel.create.mockResolvedValue({});

    const result = await service.registrarToken('user1', 'token123', 'android');
    expect(mockModel.findOne).toHaveBeenCalledWith({ userId: 'user1', token: 'token123' });
    expect(mockModel.create).toHaveBeenCalled();
    expect(result).toEqual({ registrado: true });
  });

  it('no debe registrar token si ya existe', async () => {
    mockModel.findOne.mockResolvedValue({ userId: 'user1', token: 'token123' });

    const result = await service.registrarToken('user1', 'token123', 'android');
    expect(mockModel.create).not.toHaveBeenCalled();
    expect(result).toEqual({ registrado: true });
  });

  it('debe enviar notificaciones push', async () => {
    mockModel.find.mockResolvedValue([{ token: 'abc123' }]);
    mockedAxios.post.mockResolvedValue({
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config: { url: 'https://fake.onesignal.com/api/v1/notifications' },
    });

    await service.enviarNotificacionPush('user1', 'Título', 'Mensaje');
    expect(mockedAxios.post).toHaveBeenCalled();
  });
});
