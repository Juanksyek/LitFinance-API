import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../user/schemas/user.schema/user.schema';

@Injectable()
export class UpdateActivityMiddleware implements NestMiddleware {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Solo actualizar si hay usuario autenticado
    if (req['user'] && req['user'].id) {
      try {
        await this.userModel.updateOne(
          { id: req['user'].id },
          { $set: { lastActivityAt: new Date() } }
        );
      } catch (error) {
        // No bloquear la petición si falla la actualización
        console.error('Error actualizando lastActivityAt:', error);
      }
    }
    next();
  }
}
