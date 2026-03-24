import {
  Injectable, Logger, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TicketScan, TicketScanDocument, TicketItem } from './schemas/ticket-scan.schema';
import {
  CreateTicketFromOcrDto,
  CreateTicketManualDto,
  ConfirmTicketDto,
  TicketItemDto,
} from './dto/ticket-scan.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { UserService } from '../user/user.service';
import { generateUniqueId } from '../utils/generate-id';
import { DashboardVersionService } from '../user/services/dashboard-version.service';
import { OcrPipeline } from './ocr';
import { CATEGORY_KEYWORDS, STORE_CATEGORY_HINTS } from './ocr/ocr.constants';

@Injectable()
export class TicketScanService {
  private readonly logger = new Logger(TicketScanService.name);

  constructor(
    @InjectModel(TicketScan.name) private readonly ticketModel: Model<TicketScanDocument>,
    private readonly transactionsService: TransactionsService,
    private readonly userService: UserService,
    private readonly dashboardVersionService: DashboardVersionService,
    private readonly ocrPipeline: OcrPipeline,
  ) {}

  // ─── Categorización inteligente ──────────────────────────────

  categorizeItem(itemName: string, storeName?: string): { categoria: string; confianza: number } {
    const normalized = itemName.toLowerCase().trim();

    // 1. Buscar match directo por keywords del artículo
    let bestCategory = 'otros';
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const kw of keywords) {
        if (normalized.includes(kw)) {
          const score = kw.length / normalized.length; // Cuanto más del nombre cubre el keyword, mejor
          if (score > bestScore) {
            bestScore = score;
            bestCategory = category;
          }
        }
      }
    }

    if (bestScore > 0) {
      return { categoria: bestCategory, confianza: Math.min(bestScore + 0.3, 0.95) };
    }

    // 2. Fallback: usar la tienda como pista
    if (storeName) {
      const storeNorm = storeName.toLowerCase().trim();
      for (const [storeKey, cat] of Object.entries(STORE_CATEGORY_HINTS)) {
        if (storeNorm.includes(storeKey)) {
          return { categoria: cat, confianza: 0.5 };
        }
      }
    }

    return { categoria: 'otros', confianza: 0.1 };
  }

  categorizeItems(items: TicketItemDto[], storeName?: string): TicketItem[] {
    return items.map((item) => {
      const existing = item.categoria && item.categoria !== 'otros';
      const { categoria, confianza } = existing
        ? { categoria: item.categoria!, confianza: item.confianza ?? 1 }
        : this.categorizeItem(item.nombre, storeName);
      return {
        nombre: item.nombre,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        subtotal: item.subtotal,
        categoria,
        confianza,
        detalles: item.detalles ?? [],
      };
    });
  }

  buildCategorySummary(items: TicketItem[]): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const item of items) {
      const cat = item.categoria ?? 'otros';
      summary[cat] = (summary[cat] ?? 0) + item.subtotal;
    }
    return summary;
  }

  // ─── Crear ticket desde OCR (pipeline modular) ───────────────

  async createFromOcr(userId: string, dto: CreateTicketFromOcrDto, clientOcrText?: string) {
    const user = await this.userService.getProfile(userId);
    const moneda = dto.moneda || user.monedaPrincipal || 'MXN';

    // 1. Ejecutar pipeline OCR: multi-variante → parse → score → best
    const clientText = clientOcrText ?? dto.ocrTexto ?? '';
    let parsed;

    if (dto.imagenBase64) {
      parsed = await this.ocrPipeline.process(
        dto.imagenBase64,
        dto.imagenMimeType ?? 'image/jpeg',
        clientText || undefined,
      );
    } else if (clientText.trim().length > 10) {
      parsed = this.ocrPipeline.parseText(clientText);
    } else {
      parsed = null;
    }

    const ticketId = await generateUniqueId(this.ticketModel, 'ticketId');

    const itemDtos = parsed
      ? parsed.items.map((it) => ({
          nombre: it.nombre,
          cantidad: it.cantidad,
          precioUnitario: it.precioUnitario,
          subtotal: it.subtotal,
          categoria: it.categoria,
          confianza: it.confianza,
          detalles: it.detalles,
        }))
      : [];
    const items = this.categorizeItems(itemDtos, parsed?.tienda);
    const resumenCategorias = this.buildCategorySummary(items);

    const ticket = await this.ticketModel.create({
      ticketId,
      userId,
      tienda: parsed?.tienda ?? 'Por confirmar',
      direccionTienda: parsed?.direccionTienda ?? '',
      fechaCompra: parsed?.fechaCompra ? new Date(parsed.fechaCompra) : new Date(),
      items,
      subtotal: parsed?.subtotal ?? 0,
      impuestos: parsed?.impuestos ?? 0,
      descuentos: parsed?.descuentos ?? 0,
      propina: parsed?.propina ?? 0,
      total: parsed?.total ?? 0,
      moneda,
      metodoPago: parsed?.metodoPago ?? '',
      estado: 'review',
      confirmado: false,
      imagenBase64: dto.imagenBase64,
      imagenMimeType: dto.imagenMimeType ?? 'image/jpeg',
      ocrTextoRaw: parsed?.rawText ?? clientText ?? '',
      resumenCategorias,
      cuentaId: dto.cuentaId ?? undefined,
      subCuentaId: dto.subCuentaId ?? undefined,
    });

    // Si autoConfirm y tenemos datos válidos, crear transacción inmediatamente
    if (dto.autoConfirm && parsed && parsed.total > 0) {
      return this.confirmAndCharge(userId, ticketId);
    }

    const response = {
      message: 'Ticket procesado. Revisa los datos y confirma para aplicar el cargo.',
      ticket: this.formatTicketResponse(ticket),
    };
    this.logger.log(
      `[SCAN-RESPONSE] ═══ RESPUESTA AL FRONT ═══\n` +
      JSON.stringify(response.ticket, null, 2),
    );
    return response;
  }

  // ─── Crear ticket manual ─────────────────────────────────────

  async createManual(userId: string, dto: CreateTicketManualDto) {
    const user = await this.userService.getProfile(userId);
    const moneda = dto.moneda || user.monedaPrincipal || 'MXN';
    const ticketId = await generateUniqueId(this.ticketModel, 'ticketId');

    const items = this.categorizeItems(dto.items, dto.tienda);
    const resumenCategorias = this.buildCategorySummary(items);

    const ticket = await this.ticketModel.create({
      ticketId,
      userId,
      tienda: dto.tienda,
      direccionTienda: dto.direccionTienda ?? '',
      fechaCompra: new Date(dto.fechaCompra),
      items,
      subtotal: dto.subtotal,
      impuestos: dto.impuestos ?? 0,
      descuentos: dto.descuentos ?? 0,
      propina: dto.propina ?? 0,
      total: dto.total,
      moneda,
      metodoPago: dto.metodoPago ?? '',
      estado: 'review',
      confirmado: false,
      imagenBase64: dto.imagenBase64 ?? undefined,
      imagenMimeType: dto.imagenMimeType ?? undefined,
      notas: dto.notas ?? '',
      resumenCategorias,
      cuentaId: dto.cuentaId ?? undefined,
      subCuentaId: dto.subCuentaId ?? undefined,
    });

    return {
      message: 'Ticket creado. Confirma para aplicar el cargo.',
      ticket: this.formatTicketResponse(ticket),
    };
  }

  // ─── Confirmar y aplicar cargo ───────────────────────────────

  async confirmAndCharge(userId: string, ticketId: string, edits?: ConfirmTicketDto) {
    const ticket = await this.ticketModel.findOne({ ticketId, userId });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.confirmado) throw new BadRequestException('Este ticket ya fue confirmado');
    if (ticket.estado === 'cancelled') throw new BadRequestException('Este ticket fue cancelado');

    // Aplicar ediciones del usuario antes de confirmar
    if (edits) {
      if (edits.tienda) ticket.tienda = edits.tienda;
      if (edits.fechaCompra) ticket.fechaCompra = new Date(edits.fechaCompra);
      if (edits.items) {
        ticket.items = this.categorizeItems(edits.items, ticket.tienda);
        ticket.resumenCategorias = this.buildCategorySummary(ticket.items);
      }
      if (edits.subtotal !== undefined) ticket.subtotal = edits.subtotal;
      if (edits.impuestos !== undefined) ticket.impuestos = edits.impuestos;
      if (edits.descuentos !== undefined) ticket.descuentos = edits.descuentos;
      if (edits.propina !== undefined) ticket.propina = edits.propina;
      if (edits.total !== undefined) ticket.total = edits.total;
      if (edits.moneda) ticket.moneda = edits.moneda;
      if (edits.metodoPago) ticket.metodoPago = edits.metodoPago;
      if (edits.cuentaId) ticket.cuentaId = edits.cuentaId;
      if (edits.subCuentaId) ticket.subCuentaId = edits.subCuentaId;
      if (edits.notas) ticket.notas = edits.notas;
    }

    if (ticket.total <= 0) {
      throw new BadRequestException('El total del ticket debe ser mayor a 0 para crear una transacción');
    }

    // Crear transacción de egreso — el concepto es el nombre de la tienda/comercio del ticket
    const txResult = await this.transactionsService.crear(
      {
        tipo: 'egreso',
        monto: ticket.total,
        moneda: ticket.moneda,
        concepto: `Compra en ${ticket.tienda}`,
        motivo: `Ticket #${ticket.ticketId} — ${ticket.tienda}`,
        cuentaId: ticket.cuentaId ?? undefined,
        subCuentaId: ticket.subCuentaId ?? undefined,
        afectaCuenta: true,
        fecha: ticket.fechaCompra.toISOString(),
      },
      userId,
    );

    // Actualizar ticket con la transacción generada
    ticket.transaccionId = (txResult.transaccion as any).transaccionId;
    ticket.estado = 'completed';
    ticket.confirmado = true;
    await ticket.save();

    await this.dashboardVersionService.touchDashboard(userId, 'ticket_scan.confirm');

    return {
      message: 'Ticket confirmado y cargo aplicado automáticamente.',
      ticket: this.formatTicketResponse(ticket),
      transaccion: txResult.transaccion,
    };
  }

  // ─── Listar tickets del usuario ──────────────────────────────

  async list(userId: string, filters?: {
    estado?: string;
    tienda?: string;
    desde?: string;
    hasta?: string;
    page?: number;
    limit?: number;
  }) {
    const query: any = { userId };

    if (filters?.estado) query.estado = filters.estado;
    if (filters?.tienda) {
      query.tienda = { $regex: filters.tienda, $options: 'i' };
    }
    if (filters?.desde || filters?.hasta) {
      query.fechaCompra = {};
      if (filters.desde) query.fechaCompra.$gte = new Date(filters.desde);
      if (filters.hasta) query.fechaCompra.$lte = new Date(filters.hasta);
    }

    const page = Math.max(1, filters?.page ?? 1);
    const limit = Math.min(50, Math.max(1, filters?.limit ?? 20));
    const skip = (page - 1) * limit;

    const [tickets, total] = await Promise.all([
      this.ticketModel
        .find(query)
        .select('-imagenBase64 -ocrTextoRaw') // No enviar imagen en listado
        .sort({ fechaCompra: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.ticketModel.countDocuments(query),
    ]);

    return {
      total,
      page,
      limit,
      data: tickets,
    };
  }

  // ─── Detalle de un ticket ────────────────────────────────────

  async getById(userId: string, ticketId: string, includeImage = false) {
    const select = includeImage ? '' : '-imagenBase64';
    const ticket = await this.ticketModel
      .findOne({ ticketId, userId })
      .select(select)
      .lean();

    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    return ticket;
  }

  // ─── Obtener imagen del ticket ───────────────────────────────

  async getImage(userId: string, ticketId: string) {
    const ticket = await this.ticketModel
      .findOne({ ticketId, userId })
      .select('imagenBase64 imagenMimeType')
      .lean();

    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (!ticket.imagenBase64) throw new NotFoundException('Este ticket no tiene imagen guardada');

    return {
      imagenBase64: ticket.imagenBase64,
      mimeType: ticket.imagenMimeType ?? 'image/jpeg',
    };
  }

  // ─── Eliminar ticket ─────────────────────────────────────────

  async remove(userId: string, ticketId: string) {
    const ticket = await this.ticketModel.findOne({ ticketId, userId });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');

    const transaccionIdAsociada = ticket.transaccionId ?? null;
    await this.ticketModel.deleteOne({ ticketId, userId });

    await this.dashboardVersionService.touchDashboard(userId, 'ticket_scan.delete');

    return {
      message: transaccionIdAsociada
        ? 'Ticket eliminado. Nota: la transacción asociada NO fue eliminada automáticamente.'
        : 'Ticket eliminado.',
      ticketId,
      transaccionIdAsociada,
    };
  }

  // ─── Cancelar ticket ────────────────────────────────────────

  async cancel(userId: string, ticketId: string) {
    const ticket = await this.ticketModel.findOne({ ticketId, userId });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.estado === 'cancelled') throw new BadRequestException('Ya está cancelado');

    // Si ya tenía transacción, advertir (la transacción no se revierte automáticamente)
    const hadTransaction = !!ticket.transaccionId;

    ticket.estado = 'cancelled';
    await ticket.save();

    await this.dashboardVersionService.touchDashboard(userId, 'ticket_scan.cancel');

    return {
      message: hadTransaction
        ? 'Ticket cancelado. Nota: la transacción asociada NO fue revertida automáticamente. Si deseas revertirla, elimínala manualmente.'
        : 'Ticket cancelado.',
      ticketId,
      transaccionIdAsociada: ticket.transaccionId ?? null,
    };
  }

  // ─── Analytics: resumen de tickets ───────────────────────────

  async getTicketAnalytics(userId: string, desde?: string, hasta?: string) {
    const query: any = { userId, estado: 'completed' };
    if (desde || hasta) {
      query.fechaCompra = {};
      if (desde) query.fechaCompra.$gte = new Date(desde);
      if (hasta) query.fechaCompra.$lte = new Date(hasta);
    }

    const [
      totalTickets,
      byStore,
      byCategory,
      totalGastado,
    ] = await Promise.all([
      this.ticketModel.countDocuments(query),

      this.ticketModel.aggregate([
        { $match: query },
        { $group: { _id: '$tienda', count: { $sum: 1 }, total: { $sum: '$total' } } },
        { $sort: { total: -1 } },
        { $limit: 20 },
      ]).exec(),

      this.ticketModel.aggregate([
        { $match: query },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.categoria',
            count: { $sum: '$items.cantidad' },
            total: { $sum: '$items.subtotal' },
          },
        },
        { $sort: { total: -1 } },
      ]).exec(),

      this.ticketModel.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]).exec(),
    ]);

    return {
      totalTickets,
      totalGastado: totalGastado[0]?.total ?? 0,
      porTienda: byStore.map((s: any) => ({
        tienda: s._id,
        tickets: s.count,
        total: s.total,
      })),
      porCategoria: byCategory.map((c: any) => ({
        categoria: c._id ?? 'otros',
        articulos: c.count,
        total: c.total,
      })),
    };
  }

  // ─── Re-categorizar (si usuario edita nombre del item) ───────

  async recategorizeTicket(userId: string, ticketId: string) {
    const ticket = await this.ticketModel.findOne({ ticketId, userId });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');

    ticket.items = this.categorizeItems(ticket.items as any, ticket.tienda);
    ticket.resumenCategorias = this.buildCategorySummary(ticket.items as any);
    await ticket.save();

    return this.formatTicketResponse(ticket);
  }

  // ─── Formatear respuesta (sin imagen en base64) ──────────────

  private formatTicketResponse(ticket: any) {
    const t = ticket.toObject ? ticket.toObject() : ticket;
    const { imagenBase64, ocrTextoRaw, ...rest } = t;
    return {
      ...rest,
      hasImage: !!imagenBase64,
    };
  }
}
