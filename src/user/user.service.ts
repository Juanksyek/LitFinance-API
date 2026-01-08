import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Moneda, MonedaDocument } from '../moneda/schema/moneda.schema';
import { reconcileEntitlements } from './premium-entitlements';

@Injectable()
export class UserService {
    async syncPremiumStatus(userId: string) {
      const user = await this.userModel.findOne({ id: userId });
      if (!user) return;
      const now = new Date();
      const reconciled = reconcileEntitlements(user as any, now);
      const set: any = {
        isPremium: reconciled.isPremium,
        planType: reconciled.planType,
        premiumUntil: reconciled.premiumUntil,
        jarExpiresAt: reconciled.jarExpiresAt,
        jarRemainingMs: reconciled.jarRemainingMs,
      };
      if ('premiumSubscriptionId' in reconciled) set.premiumSubscriptionId = reconciled.premiumSubscriptionId;
      if ('premiumSubscriptionStatus' in reconciled) set.premiumSubscriptionStatus = reconciled.premiumSubscriptionStatus;
      if ('premiumSubscriptionUntil' in reconciled) set.premiumSubscriptionUntil = reconciled.premiumSubscriptionUntil;
      if ('premiumBonusDays' in reconciled) set.premiumBonusDays = reconciled.premiumBonusDays;

      await this.userModel.updateOne({ id: userId }, { $set: set });
      return reconciled.isPremium;
    }
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Moneda.name) private readonly monedaModel: Model<MonedaDocument>,
  ) {}

  async getProfile(userId: string) {
    const user = await this.userModel.findOne({ id: userId }).select('-password -activationToken -resetCode');
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return user;
  }  

  async updateProfile(userId: string, updateData: UpdateProfileDto) {
    // Validar que no se intente cambiar la moneda principal
    if ('monedaPrincipal' in updateData) {
      throw new BadRequestException(
        'La moneda principal no se puede cambiar desde la app. Contacta a soporte si necesitas cambiarla.'
      );
    }

    if (updateData.email) {
      const existingUser = await this.userModel.findOne({ 
        email: updateData.email, 
        id: { $ne: userId } 
      });
      if (existingUser) {
        throw new BadRequestException('El correo electrónico ya está en uso por otro usuario');
      }
    }

    if (updateData.monedaPreferencia) {
      const monedaExists = await this.monedaModel.findOne({ codigo: updateData.monedaPreferencia });
      if (!monedaExists) {
        throw new BadRequestException(`La moneda ${updateData.monedaPreferencia} no existe`);
      }
    }

    const user = await this.userModel.findOneAndUpdate(
      { id: userId },
      { $set: updateData },
      { new: true },
    ).select('-password -activationToken -resetCode');
    
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return {
      message: 'Perfil actualizado correctamente',
      user,
    };
  }

  async toggleMonedaFavorita(userId: string, codigoMoneda: string) {
    const monedaExists = await this.monedaModel.findOne({ codigo: codigoMoneda });
    if (!monedaExists) {
      throw new BadRequestException(`La moneda ${codigoMoneda} no existe`);
    }

    const user = await this.userModel.findOne({ id: userId });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const monedasFavoritas = user.monedasFavoritas || [];
    const yaEsFavorita = monedasFavoritas.includes(codigoMoneda);

    let updateOperation;
    let mensaje;

    if (yaEsFavorita) {
      updateOperation = { $pull: { monedasFavoritas: codigoMoneda } };
      mensaje = `Moneda ${codigoMoneda} removida de favoritas`;
    } else {
      updateOperation = { $push: { monedasFavoritas: codigoMoneda } };
      mensaje = `Moneda ${codigoMoneda} añadida a favoritas`;
    }

    const updatedUser = await this.userModel.findOneAndUpdate(
      { id: userId },
      updateOperation,
      { new: true }
    ).select('-password -activationToken -resetCode');

    if (!updatedUser) {
      throw new NotFoundException('Usuario no encontrado al actualizar');
    }

    return {
      message: mensaje,
      esFavorita: !yaEsFavorita,
      monedasFavoritas: updatedUser.monedasFavoritas,
    };
  }

  async getMonedasFavoritas(userId: string) {
    const user = await this.userModel.findOne({ id: userId }).select('monedasFavoritas');
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const monedasDetalladas = await this.monedaModel.find({ 
      codigo: { $in: user.monedasFavoritas || [] } 
    }).sort({ codigo: 1 });

    return {
      monedasFavoritas: user.monedasFavoritas || [],
      detalles: monedasDetalladas,
    };
  }  
}
