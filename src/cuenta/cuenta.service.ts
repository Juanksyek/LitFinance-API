import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cuenta } from './schemas/cuenta.schema/cuenta.schema';
import { UpdateCuentaDto } from './dto/update-cuenta.dto/update-cuenta.dto';

@Injectable()
export class CuentaService {
  constructor(@InjectModel(Cuenta.name) private cuentaModel: Model<Cuenta>) {}

  async obtenerCuentaPrincipal(userId: string): Promise<Cuenta> {
    const cuenta = await this.cuentaModel.findOne({ userId, isPrincipal: true });
    if (!cuenta) {
      throw new NotFoundException('Cuenta principal no encontrada');
    }
    return cuenta;
  }

  async editarCuentaPrincipal(userId: string, updateData: UpdateCuentaDto): Promise<Cuenta> {
    const cuenta = await this.cuentaModel.findOneAndUpdate(
      { userId, isPrincipal: true },
      { $set: updateData },
      { new: true }
    );
    if (!cuenta) {
      throw new NotFoundException('Cuenta principal no encontrada');
    }
    return cuenta;
  }
}
