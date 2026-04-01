import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TicketScan, TicketScanDocument } from '../schemas/ticket-scan.schema';

/**
 * Evaluación por campo: mide la precisión del sistema de escaneo
 * comparando datos originales vs correcciones del usuario.
 *
 * Benchmark interno que mide por separado:
 *   - tienda
 *   - fecha
 *   - subtotal
 *   - impuestos
 *   - total
 *   - items (cantidad exacta)
 *   - precio unitario (exactitud)
 */
@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    @InjectModel(TicketScan.name) private readonly ticketModel: Model<TicketScanDocument>,
  ) {}

  /**
   * Genera un reporte de precisión por campo basado en tickets corregidos.
   *
   * @param userId - Si se proporciona, filtra por usuario
   * @param desde - Fecha de inicio (ISO string)
   * @param hasta - Fecha de fin (ISO string)
   */
  async getAccuracyReport(userId?: string, desde?: string, hasta?: string) {
    const query: any = {
      wasUserCorrected: true,
      userCorrections: { $exists: true, $ne: null },
    };

    if (userId) query.userId = userId;
    if (desde || hasta) {
      query.createdAt = {};
      if (desde) query.createdAt.$gte = new Date(desde);
      if (hasta) query.createdAt.$lte = new Date(hasta);
    }

    const correctedTickets = await this.ticketModel
      .find(query)
      .select('tienda total subtotal impuestos items ocrScore tipoTicket extractorUsed fieldConfidence userCorrections')
      .lean();

    if (correctedTickets.length === 0) {
      return {
        totalEvaluated: 0,
        message: 'No hay tickets corregidos para evaluar',
        fields: {},
      };
    }

    const fieldStats = {
      tienda: { correct: 0, total: 0 },
      fecha: { correct: 0, total: 0 },
      total: { correct: 0, total: 0, avgError: 0, totalError: 0 },
      subtotal: { correct: 0, total: 0, avgError: 0, totalError: 0 },
      impuestos: { correct: 0, total: 0, avgError: 0, totalError: 0 },
      items: { correct: 0, total: 0, avgDiff: 0, totalDiff: 0 },
    };

    const extractorStats: Record<string, { correct: number; total: number }> = {};
    const ticketTypeStats: Record<string, { correct: number; total: number }> = {};

    for (const ticket of correctedTickets) {
      const corrections = ticket.userCorrections as any;
      if (!corrections) continue;

      // Tienda
      if (corrections.tiendaOriginal !== undefined) {
        fieldStats.tienda.total++;
        if (corrections.tiendaOriginal === ticket.tienda) {
          fieldStats.tienda.correct++;
        }
      }

      // Fecha
      if (corrections.fechaOriginal !== undefined) {
        fieldStats.fecha.total++;
        if (corrections.fechaOriginal === ticket.fechaCompra?.toISOString()) {
          fieldStats.fecha.correct++;
        }
      }

      // Total
      if (corrections.totalOriginal !== undefined) {
        fieldStats.total.total++;
        const diff = Math.abs((corrections.totalOriginal as number) - ticket.total);
        fieldStats.total.totalError += diff;
        if (diff < 0.01) fieldStats.total.correct++;
      }

      // Subtotal
      if (corrections.subtotalOriginal !== undefined) {
        fieldStats.subtotal.total++;
        const diff = Math.abs((corrections.subtotalOriginal as number) - ticket.subtotal);
        fieldStats.subtotal.totalError += diff;
        if (diff < 0.01) fieldStats.subtotal.correct++;
      }

      // Impuestos
      if (corrections.impuestosOriginal !== undefined) {
        fieldStats.impuestos.total++;
        const diff = Math.abs((corrections.impuestosOriginal as number) - ticket.impuestos);
        fieldStats.impuestos.totalError += diff;
        if (diff < 0.01) fieldStats.impuestos.correct++;
      }

      // Items
      if (corrections.itemsOriginal !== undefined) {
        fieldStats.items.total++;
        const diff = Math.abs((corrections.itemsOriginal as number) - (ticket.items?.length ?? 0));
        fieldStats.items.totalDiff += diff;
        if (diff === 0) fieldStats.items.correct++;
      }

      // Stats por extractor
      const extractor = (ticket as any).extractorUsed ?? 'unknown';
      if (!extractorStats[extractor]) extractorStats[extractor] = { correct: 0, total: 0 };
      extractorStats[extractor].total++;
      if (corrections.totalOriginal !== undefined && Math.abs(corrections.totalOriginal - ticket.total) < 0.01) {
        extractorStats[extractor].correct++;
      }

      // Stats por tipo de ticket
      const tipo = (ticket as any).tipoTicket ?? 'unknown';
      if (!ticketTypeStats[tipo]) ticketTypeStats[tipo] = { correct: 0, total: 0 };
      ticketTypeStats[tipo].total++;
      if (corrections.totalOriginal !== undefined && Math.abs(corrections.totalOriginal - ticket.total) < 0.01) {
        ticketTypeStats[tipo].correct++;
      }
    }

    // Calcular promedios
    if (fieldStats.total.total > 0) {
      fieldStats.total.avgError = fieldStats.total.totalError / fieldStats.total.total;
    }
    if (fieldStats.subtotal.total > 0) {
      fieldStats.subtotal.avgError = fieldStats.subtotal.totalError / fieldStats.subtotal.total;
    }
    if (fieldStats.impuestos.total > 0) {
      fieldStats.impuestos.avgError = fieldStats.impuestos.totalError / fieldStats.impuestos.total;
    }
    if (fieldStats.items.total > 0) {
      fieldStats.items.avgDiff = fieldStats.items.totalDiff / fieldStats.items.total;
    }

    return {
      totalEvaluated: correctedTickets.length,
      fields: {
        tienda: {
          evaluated: fieldStats.tienda.total,
          accuracy: fieldStats.tienda.total > 0
            ? (fieldStats.tienda.correct / fieldStats.tienda.total * 100).toFixed(1) + '%'
            : 'N/A',
        },
        fecha: {
          evaluated: fieldStats.fecha.total,
          accuracy: fieldStats.fecha.total > 0
            ? (fieldStats.fecha.correct / fieldStats.fecha.total * 100).toFixed(1) + '%'
            : 'N/A',
        },
        total: {
          evaluated: fieldStats.total.total,
          accuracy: fieldStats.total.total > 0
            ? (fieldStats.total.correct / fieldStats.total.total * 100).toFixed(1) + '%'
            : 'N/A',
          avgError: `$${fieldStats.total.avgError.toFixed(2)}`,
        },
        subtotal: {
          evaluated: fieldStats.subtotal.total,
          accuracy: fieldStats.subtotal.total > 0
            ? (fieldStats.subtotal.correct / fieldStats.subtotal.total * 100).toFixed(1) + '%'
            : 'N/A',
          avgError: `$${fieldStats.subtotal.avgError.toFixed(2)}`,
        },
        impuestos: {
          evaluated: fieldStats.impuestos.total,
          accuracy: fieldStats.impuestos.total > 0
            ? (fieldStats.impuestos.correct / fieldStats.impuestos.total * 100).toFixed(1) + '%'
            : 'N/A',
          avgError: `$${fieldStats.impuestos.avgError.toFixed(2)}`,
        },
        items: {
          evaluated: fieldStats.items.total,
          accuracy: fieldStats.items.total > 0
            ? (fieldStats.items.correct / fieldStats.items.total * 100).toFixed(1) + '%'
            : 'N/A',
          avgDiff: fieldStats.items.avgDiff.toFixed(1),
        },
      },
      porExtractor: Object.entries(extractorStats).map(([name, stat]) => ({
        extractor: name,
        total: stat.total,
        accuracy: stat.total > 0 ? (stat.correct / stat.total * 100).toFixed(1) + '%' : 'N/A',
      })),
      porTipoTicket: Object.entries(ticketTypeStats).map(([tipo, stat]) => ({
        tipo,
        total: stat.total,
        accuracy: stat.total > 0 ? (stat.correct / stat.total * 100).toFixed(1) + '%' : 'N/A',
      })),
    };
  }
}
