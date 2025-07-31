// commnt
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema/user.schema';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async getProfile(userId: string) {
    const user = await this.userModel.findOne({ id: userId });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return user;
  }  

  async updateProfile(userId: string, updateData: any) {
    const user = await this.userModel.findOneAndUpdate(
      { id: userId },
      { $set: updateData },
      { new: true },
    );
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return {
      message: 'Perfil actualizado correctamente',
      user,
    };
  }  
}
