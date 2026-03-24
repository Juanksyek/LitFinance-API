import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SharedCategory, SharedCategoryDocument } from '../schemas/shared-category.schema';
import { SharedAuditService } from './shared-audit.service';
import { generateUniqueId } from '../../utils/generate-id';

@Injectable()
export class SharedCategoriesService {
  constructor(
    @InjectModel(SharedCategory.name)
    private readonly categoryModel: Model<SharedCategoryDocument>,
    private readonly auditService: SharedAuditService,
  ) {}

  async create(spaceId: string, dto: { nombre: string; icono?: string; color?: string }, actorUserId: string) {
    const categoryId = await generateUniqueId(this.categoryModel, 'categoryId');
    const category = await this.categoryModel.create({
      categoryId,
      spaceId,
      nombre: dto.nombre,
      icono: dto.icono ?? '',
      color: dto.color ?? '#6C63FF',
      isSystem: false,
      estado: 'active',
    });

    await this.auditService.log({
      spaceId,
      entityType: 'category',
      entityId: categoryId,
      action: 'created',
      actorUserId,
      payloadAfter: { nombre: dto.nombre },
    });

    return category;
  }

  async list(spaceId: string) {
    return this.categoryModel.find({ spaceId, estado: 'active' }).sort({ nombre: 1 }).lean();
  }

  async update(spaceId: string, categoryId: string, dto: { nombre?: string; icono?: string; color?: string }, actorUserId: string) {
    const cat = await this.categoryModel.findOne({ categoryId, spaceId, estado: 'active' });
    if (!cat) throw new NotFoundException('Categoría no encontrada');

    const before = { nombre: cat.nombre, icono: cat.icono, color: cat.color };
    if (dto.nombre !== undefined) cat.nombre = dto.nombre;
    if (dto.icono !== undefined) cat.icono = dto.icono;
    if (dto.color !== undefined) cat.color = dto.color;
    await cat.save();

    await this.auditService.log({
      spaceId,
      entityType: 'category',
      entityId: categoryId,
      action: 'updated',
      actorUserId,
      payloadBefore: before,
      payloadAfter: { nombre: cat.nombre, icono: cat.icono, color: cat.color },
    });

    return cat;
  }

  async archive(spaceId: string, categoryId: string, actorUserId: string) {
    const cat = await this.categoryModel.findOne({ categoryId, spaceId });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    cat.estado = 'archived';
    await cat.save();

    await this.auditService.log({
      spaceId,
      entityType: 'category',
      entityId: categoryId,
      action: 'archived',
      actorUserId,
    });

    return { message: 'Categoría archivada', categoryId };
  }

  async createSystemDefaults(spaceId: string) {
    const defaults = [
      { nombre: 'Comida', icono: '🍽️', color: '#FF6B6B' },
      { nombre: 'Transporte', icono: '🚗', color: '#4ECDC4' },
      { nombre: 'Servicios', icono: '💡', color: '#45B7D1' },
      { nombre: 'Entretenimiento', icono: '🎮', color: '#96CEB4' },
      { nombre: 'Compras', icono: '🛒', color: '#FFEAA7' },
      { nombre: 'Otros', icono: '📦', color: '#DDA0DD' },
    ];

    for (const d of defaults) {
      const categoryId = await generateUniqueId(this.categoryModel, 'categoryId');
      await this.categoryModel.create({
        categoryId,
        spaceId,
        nombre: d.nombre,
        icono: d.icono,
        color: d.color,
        isSystem: true,
        estado: 'active',
      });
    }
  }
}
