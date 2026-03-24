import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SharedSpace, SharedSpaceDocument } from '../schemas/shared-space.schema';
import { SharedMembersService } from './shared-members.service';
import { SharedCategoriesService } from './shared-categories.service';
import { SharedAuditService } from './shared-audit.service';
import { generateUniqueId } from '../../utils/generate-id';

@Injectable()
export class SharedSpacesService {
  constructor(
    @InjectModel(SharedSpace.name) private readonly spaceModel: Model<SharedSpaceDocument>,
    private readonly membersService: SharedMembersService,
    private readonly categoriesService: SharedCategoriesService,
    private readonly auditService: SharedAuditService,
  ) {}

  async create(userId: string, dto: {
    nombre: string;
    tipo?: string;
    descripcion?: string;
    monedaBase: string;
    configuracion?: Record<string, any>;
  }) {
    const spaceId = await generateUniqueId(this.spaceModel, 'spaceId');

    const space = await this.spaceModel.create({
      spaceId,
      ownerUserId: userId,
      nombre: dto.nombre,
      tipo: dto.tipo ?? 'grupo',
      descripcion: dto.descripcion ?? '',
      monedaBase: dto.monedaBase,
      estado: 'activo',
      configuracion: {
        splitDefaultMode: 'equal',
        allowPrivateMovements: false,
        allowCategoryCustom: true,
        allowAccountImpact: true,
        maxMembers: 20,
        requireConfirmationForEdits: false,
        showMemberComparisons: true,
        ...dto.configuracion,
      },
    });

    // Crear al propietario como miembro
    await this.membersService.addMember({
      spaceId,
      userId,
      rol: 'owner',
      estado: 'active',
      actorUserId: userId,
    });

    // Crear categorías por defecto
    await this.categoriesService.createSystemDefaults(spaceId);

    await this.auditService.log({
      spaceId,
      entityType: 'space',
      entityId: spaceId,
      action: 'created',
      actorUserId: userId,
      payloadAfter: { nombre: dto.nombre, tipo: dto.tipo ?? 'grupo', monedaBase: dto.monedaBase },
    });

    return space;
  }

  async listByUser(userId: string, estado?: string, page = 1, limit = 20, search?: string) {
    // Buscar espacios donde el usuario es miembro activo
    const memberships = await this.membersService.listMemberspacesForUser(userId);
    const spaceIds = memberships.map((m) => m.spaceId);

    if (spaceIds.length === 0) return { items: [], total: 0, page, limit, totalPages: 0 };

    const filter: any = { spaceId: { $in: spaceIds } };
    if (estado) filter.estado = estado;
    if (search) filter.nombre = { $regex: search, $options: 'i' };

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.spaceModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.spaceModel.countDocuments(filter),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getById(spaceId: string): Promise<SharedSpaceDocument> {
    const space = await this.spaceModel.findOne({ spaceId });
    if (!space) throw new NotFoundException('Espacio no encontrado');
    return space;
  }

  async getDetail(spaceId: string, userId: string) {
    await this.membersService.requireActiveMember(spaceId, userId);
    const space = await this.getById(spaceId);
    const members = await this.membersService.listMembers(spaceId);

    return {
      ...space.toObject(),
      members,
      memberCount: members.length,
    };
  }

  async update(spaceId: string, userId: string, dto: {
    nombre?: string;
    tipo?: string;
    descripcion?: string;
    configuracion?: Record<string, any>;
  }) {
    await this.membersService.requireRole(spaceId, userId, ['owner', 'admin']);
    const space = await this.getById(spaceId);
    if (space.estado === 'archivado') throw new BadRequestException('El espacio está archivado');

    const before = { nombre: space.nombre, tipo: space.tipo, descripcion: space.descripcion };
    if (dto.nombre !== undefined) space.nombre = dto.nombre;
    if (dto.tipo !== undefined) space.tipo = dto.tipo;
    if (dto.descripcion !== undefined) space.descripcion = dto.descripcion;
    if (dto.configuracion) {
      space.configuracion = { ...space.configuracion, ...dto.configuracion };
      space.markModified('configuracion');
    }
    await space.save();

    await this.auditService.log({
      spaceId,
      entityType: 'space',
      entityId: spaceId,
      action: 'updated',
      actorUserId: userId,
      payloadBefore: before,
      payloadAfter: { nombre: space.nombre, tipo: space.tipo, descripcion: space.descripcion },
    });

    return space;
  }

  async archive(spaceId: string, userId: string) {
    await this.membersService.requireRole(spaceId, userId, ['owner']);
    const space = await this.getById(spaceId);
    space.estado = 'archivado';
    await space.save();

    await this.auditService.log({
      spaceId,
      entityType: 'space',
      entityId: spaceId,
      action: 'archived',
      actorUserId: userId,
    });

    return { message: 'Espacio archivado', spaceId };
  }
}
