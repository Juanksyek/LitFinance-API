import { Test, TestingModule } from '@nestjs/testing';
import { SubcuentaController } from './subcuenta.controller';
import { SubcuentaService } from './subcuenta.service';

describe('SubcuentaController', () => {
  let controller: SubcuentaController;

  const mockService = {
    crear: jest.fn(),
    listar: jest.fn(),
    actualizar: jest.fn(),
    eliminar: jest.fn(),
    obtenerHistorial: jest.fn(),
    desactivar: jest.fn(),
    activar: jest.fn(),
    calcularParticipacion: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubcuentaController],
      providers: [{ provide: SubcuentaService, useValue: mockService }],
    }).compile();

    controller = module.get<SubcuentaController>(SubcuentaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});