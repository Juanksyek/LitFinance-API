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
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';
import { generateUniqueId } from '../utils/generate-id';
import { DashboardVersionService } from '../user/services/dashboard-version.service';
import { OcrPipeline } from './ocr';
import { OcrProviderResult } from './ocr/ocr-provider.interface';
import { CATEGORY_KEYWORDS, STORE_CATEGORY_HINTS } from './ocr/ocr.constants';
import { TicketLearningService } from './learning/ticket-learning.service';

@Injectable()
export class TicketScanService {
  private readonly logger = new Logger(TicketScanService.name);

  constructor(
    @InjectModel(TicketScan.name) private readonly ticketModel: Model<TicketScanDocument>,
    private readonly transactionsService: TransactionsService,
    private readonly userService: UserService,
    private readonly dashboardVersionService: DashboardVersionService,
    private readonly ocrPipeline: OcrPipeline,
    private readonly cuentaHistorialService: CuentaHistorialService,
    private readonly learningService: TicketLearningService,
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

    // 1. Ejecutar pipeline OCR: multi-proveedor → parse → score → merge → best
    const clientText = clientOcrText ?? dto.localOcr?.rawText ?? dto.ocrTexto ?? '';
    let parsed;
    let providerResults: OcrProviderResult[] = [];
    let extractorUsed = 'none';
    let reviewLevel = 'manual';

    if (dto.imagenBase64) {
      const pipelineResult = await this.ocrPipeline.process(
        dto.imagenBase64,
        dto.imagenMimeType ?? 'image/jpeg',
        clientText || undefined,
      );
      parsed = pipelineResult.result;
      providerResults = pipelineResult.providerResults;
      extractorUsed = pipelineResult.extractorUsed;
      reviewLevel = pipelineResult.reviewLevel;
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
      ocrProvidersRaw: providerResults.map((pr) => ({
        provider: pr.provider,
        variant: pr.variant ?? '',
        rawJson: JSON.stringify(pr),
        overallConfidence: pr.overallConfidence,
      })),
      ocrRawCandidates: providerResults.map((pr) => ({
        source: pr.provider,
        variant: pr.variant ?? '',
        score: pr.overallConfidence,
        amountsDetected: 0,
        wordsDetected: pr.plainText?.split(/\s+/).length ?? 0,
      })),
      ocrBestSource: providerResults.length > 0
        ? `${providerResults[0].provider}:${providerResults[0].variant ?? ''}`
        : 'none',
      ocrFrontText: clientText || undefined,
      ocrBackText: parsed?.rawText ?? '',
      ocrConfidence: parsed?.score ?? 0,
      needsReview: reviewLevel !== 'auto',
      processingVersion: '2.0.0',
      tipoTicket: parsed?.tipoTicket ?? 'desconocido',
      extractorUsed,
      ocrScore: parsed?.score ?? 0,
      fieldConfidence: parsed?.confidence ?? {},
      reviewLevel,
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

    // Aplicar ediciones del usuario antes de confirmar (y guardar originales para training)
    if (edits) {
      const corrections: Record<string, any> = {};
      if (edits.tienda && edits.tienda !== ticket.tienda) {
        corrections.tiendaOriginal = ticket.tienda;
        ticket.tienda = edits.tienda;
      }
      if (edits.fechaCompra) {
        corrections.fechaOriginal = ticket.fechaCompra?.toISOString();
        ticket.fechaCompra = new Date(edits.fechaCompra);
      }
      if (edits.items) {
        corrections.itemsOriginal = ticket.items.length;
        ticket.items = this.categorizeItems(edits.items, ticket.tienda);
        ticket.resumenCategorias = this.buildCategorySummary(ticket.items);
      }
      if (edits.subtotal !== undefined && edits.subtotal !== ticket.subtotal) {
        corrections.subtotalOriginal = ticket.subtotal;
        ticket.subtotal = edits.subtotal;
      }
      if (edits.impuestos !== undefined && edits.impuestos !== ticket.impuestos) {
        corrections.impuestosOriginal = ticket.impuestos;
        ticket.impuestos = edits.impuestos;
      }
      if (edits.descuentos !== undefined) ticket.descuentos = edits.descuentos;
      if (edits.propina !== undefined) ticket.propina = edits.propina;
      if (edits.total !== undefined && edits.total !== ticket.total) {
        corrections.totalOriginal = ticket.total;
        ticket.total = edits.total;
      }
      if (edits.moneda) ticket.moneda = edits.moneda;
      if (edits.metodoPago) ticket.metodoPago = edits.metodoPago;
      if (edits.cuentaId) ticket.cuentaId = edits.cuentaId;
      if (edits.subCuentaId) ticket.subCuentaId = edits.subCuentaId;
      if (edits.notas) ticket.notas = edits.notas;

      // Guardar correcciones del usuario para training dataset
      if (Object.keys(corrections).length > 0) {
        corrections.correctedAt = new Date();
        ticket.userCorrections = corrections;
        ticket.wasUserCorrected = true;
      }
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

    // ─── Aprendizaje continuo: aprender del ticket confirmado ───
    this.learningService.learnFromTicket(ticket).catch((err) =>
      this.logger.warn(`[LEARNING] Error aprendiendo del ticket ${ticketId}: ${err.message}`),
    );

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
    includeImage?: boolean;
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

    const heavyExcludes = '-ocrTextoRaw -ocrProvidersRaw -ocrRawCandidates -ocrFrontText -ocrBackText';
    const select = filters?.includeImage ? heavyExcludes : `-imagenBase64 ${heavyExcludes}`;

    const [tickets, total] = await Promise.all([
      this.ticketModel
        .find(query)
        .select(select) // No enviar datos pesados en listado a menos que se solicite
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

  // ─── Liquidar ticket (pagar) ───────────────────────────────
  async liquidar(userId: string, ticketId: string, dto: { cuentaId?: string; subCuentaId?: string; monto?: number; concepto?: string }) {
    const ticket = await this.ticketModel.findOne({ ticketId, userId });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.estado === 'cancelled') throw new BadRequestException('Este ticket fue cancelado');
    if (ticket.estado === 'liquidado' || ticket.estado === 'completed') throw new BadRequestException('Este ticket ya fue liquidado');

    const monto = typeof dto.monto === 'number' && dto.monto > 0 ? dto.monto : ticket.total;
    if (monto <= 0) throw new BadRequestException('Monto inválido para liquidar');

    // Crear transacción de egreso usando TransactionsService — este método
    // maneja conversión, subcuentas y actualización de saldos e historiales.
    const txResult = await this.transactionsService.crear(
      {
        tipo: 'egreso',
        monto,
        moneda: ticket.moneda,
        concepto: dto.concepto ?? `Liquidación ticket ${ticket.ticketId}`,
        motivo: `Liquidación ticket #${ticket.ticketId} - ${ticket.tienda}`,
        cuentaId: dto.cuentaId ?? ticket.cuentaId ?? undefined,
        subCuentaId: dto.subCuentaId ?? ticket.subCuentaId ?? undefined,
        afectaCuenta: true,
        fecha: new Date().toISOString(),
        metadata: { source: 'ticket.liquidation', skipHistorial: true },
      },
      userId,
    );

    // Marcar ticket como liquidado y guardar referencia a la transacción
    ticket.estado = 'liquidado';
    ticket.confirmado = true;
    ticket.transaccionId = (txResult.transaccion as any).transaccionId;
    ticket.montoLiquidado = monto;
    ticket.liquidadoPorCuenta = dto.cuentaId ?? ticket.cuentaId ?? null;
    ticket.liquidadoPorSubcuenta = dto.subCuentaId ?? ticket.subCuentaId ?? null;
    ticket.fechaLiquidacion = new Date();
    ticket.liquidadoPorUsuario = userId;

    await ticket.save();

    // Asegurar que exista un movimiento en cuenta-historial para esta transacción
    try {
      const trans = txResult.transaccion as any;
      const transId = trans.transaccionId ?? trans._id ?? null;
      if (transId) {
        await this.cuentaHistorialService.upsertMovimientoTransaccion({
          transaccionId: String(transId),
          movimiento: {
            userId,
            cuentaId: trans.cuentaId ?? ticket.cuentaId ?? undefined,
            monto: trans.tipo === 'egreso' ? -Math.abs(trans.monto) : trans.monto,
            tipo: trans.tipo,
            descripcion: dto.concepto ?? `Liquidación ticket #${ticket.ticketId}`,
            fecha: new Date().toISOString(),
            subcuentaId: trans.subCuentaId ?? ticket.subCuentaId ?? undefined,
            metadata: { source: 'ticket.liquidation' },
          },
          audit: { source: 'ticket.liquidation', action: 'create', status: 'active' },
        });
      }
    } catch (err) {
      this.logger.error(`[LIQUIDATION] Error al upsert historial: ${err.message}`);
    }

    await this.dashboardVersionService.touchDashboard(userId, 'ticket_scan.liquidar');

    return {
      message: 'Ticket liquidado correctamente',
      ticket: this.formatTicketResponse(ticket),
      transaccion: txResult.transaccion,
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
