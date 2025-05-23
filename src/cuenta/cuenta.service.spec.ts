import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CuentaService } from './cuenta.service';
import { Cuenta } from './schemas/cuenta.schema/cuenta.schema';
import { NotFoundException } from '@nestjs/common';

describe('CuentaService', () => {
  let service: CuentaService;
  let cuentaModel: any;

  beforeEach(async () => {
    cuentaModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CuentaService,
        { provide: getModelToken(Cuenta.name), useValue: cuentaModel },
      ],
    }).compile();

    service = module.get<CuentaService>(CuentaService);
  });

  describe('obtenerCuentaPrincipal', () => {
    it('debe retornar la cuenta principal si existe', async () => {
      const mockCuenta = { id: 'cuenta123', nombre: 'Principal', isPrincipal: true };
      cuentaModel.findOne.mockResolvedValue(mockCuenta);

      const result = await service.obtenerCuentaPrincipal('user123');

      expect(result).toEqual(mockCuenta);
      expect(cuentaModel.findOne).toHaveBeenCalledWith({ userId: 'user123', isPrincipal: true });
    });

    it('debe lanzar NotFoundException si no existe la cuenta', async () => {
      cuentaModel.findOne.mockResolvedValue(null);

      await expect(service.obtenerCuentaPrincipal('user123')).rejects.toThrow(NotFoundException);
    });
  });

  describe('editarCuentaPrincipal', () => {
    it('debe actualizar la cuenta principal y retornar la cuenta actualizada', async () => {
      const updateData = { nombre: 'Cuenta Actualizada', color: '#FF0000' };
      const updatedCuenta = { id: 'cuenta123', ...updateData, isPrincipal: true };

      cuentaModel.findOneAndUpdate.mockResolvedValue(updatedCuenta);

      const result = await service.editarCuentaPrincipal('user123', updateData);

      expect(result).toEqual(updatedCuenta);
      expect(cuentaModel.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: 'user123', isPrincipal: true },
        { $set: updateData },
        { new: true }
      );
    });

    it('debe lanzar NotFoundException si la cuenta no existe', async () => {
      cuentaModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.editarCuentaPrincipal('user123', { nombre: 'Nueva Cuenta' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});