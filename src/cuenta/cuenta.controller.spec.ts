import { Test, TestingModule } from '@nestjs/testing';
import { CuentaController } from './cuenta.controller';
import { CuentaService } from './cuenta.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('CuentaController', () => {
  let controller: CuentaController;
  let service: CuentaService;

  const mockCuentaService = {
    obtenerCuentaPrincipal: jest.fn(),
    editarCuentaPrincipal: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CuentaController],
      providers: [{ provide: CuentaService, useValue: mockCuentaService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<CuentaController>(CuentaController);
    service = module.get<CuentaService>(CuentaService);
  });

  describe('getCuentaPrincipal', () => {
    it('debe retornar la cuenta principal usando el userId del token', async () => {
      const mockCuenta = { id: 'c1', nombre: 'Principal', color: '#000', isPrincipal: true };
      mockCuentaService.obtenerCuentaPrincipal.mockResolvedValue(mockCuenta);

      const req = { user: { sub: 'user123' } };

      const result = await controller.getCuentaPrincipal(req);

      expect(result).toEqual(mockCuenta);
      expect(service.obtenerCuentaPrincipal).toHaveBeenCalledWith('user123');
    });
  });

  describe('updateCuentaPrincipal', () => {
    it('debe actualizar la cuenta principal correctamente', async () => {
      const dto = { nombre: 'Cuenta actualizada', color: '#ABCDEF' };
      const updatedCuenta = { id: 'c1', ...dto, isPrincipal: true };

      mockCuentaService.editarCuentaPrincipal.mockResolvedValue(updatedCuenta);

      const req = { user: { sub: 'user123' } };

      const result = await controller.updateCuentaPrincipal(req, dto);

      expect(result).toEqual(updatedCuenta);
      expect(service.editarCuentaPrincipal).toHaveBeenCalledWith('user123', dto);
    });
  });
});