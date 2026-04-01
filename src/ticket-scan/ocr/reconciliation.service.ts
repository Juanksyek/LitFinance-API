import { Injectable, Logger } from '@nestjs/common';
import { TicketParseResult, ParsedItem, FieldConfidence } from './ocr.types';
import { OcrProviderResult, StructuredLineItem, StructuredField } from './ocr-provider.interface';

/**
 * Reconciliación contable: valida coherencia de los datos extraídos,
 * fusiona resultados de múltiples proveedores, y elige el mejor candidato por campo.
 *
 * Reglas:
 *   1. suma_items ≈ subtotal → coherente
 *   2. subtotal + impuestos - descuentos ≈ total → coherente
 *   3. Si un proveedor tiene mejores items pero otro tiene mejor total → merge
 *   4. Confianza por campo para decidir: autoconfirm vs review vs manual
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  /**
   * Reconcilia un resultado parseado: valida coherencia contable y calcula confidence.
   */
  reconcile(result: TicketParseResult): TicketParseResult {
    const warnings: string[] = [...result.warnings];

    const itemsSum = result.items.reduce((s, it) => s + it.subtotal, 0);
    const roundedItemsSum = Math.round(itemsSum * 100) / 100;

    let { subtotal, total, impuestos, descuentos, iva, ieps } = result;

    // ─── 1. Corregir subtotal si es 0 ─────────────────────────────
    if (subtotal === 0 && roundedItemsSum > 0) {
      subtotal = roundedItemsSum;
      warnings.push('Subtotal calculado desde items');
    }

    // ─── 2. Verificar coherencia items vs subtotal ────────────────
    if (subtotal > 0 && roundedItemsSum > 0) {
      const diff = Math.abs(roundedItemsSum - subtotal);
      const tolerance = subtotal * 0.05; // 5% de tolerancia
      if (diff > tolerance) {
        warnings.push(
          `Diferencia items-subtotal: $${roundedItemsSum.toFixed(2)} vs $${subtotal.toFixed(2)} (dif=${diff.toFixed(2)})`,
        );
      }
    }

    // ─── 3. Verificar coherencia subtotal + impuestos = total ─────
    if (total > 0 && subtotal > 0) {
      const expectedTotal = subtotal + impuestos - descuentos;
      const diff = Math.abs(expectedTotal - total);
      const tolerance = total * 0.05;

      if (diff > tolerance) {
        warnings.push(
          `Subtotal($${subtotal.toFixed(2)}) + Imp($${impuestos.toFixed(2)}) - Desc($${descuentos.toFixed(2)}) = $${expectedTotal.toFixed(2)}, pero Total=$${total.toFixed(2)}`,
        );
      }
    }

    // ─── 4. Corregir total si es 0 o incoherente ─────────────────
    if (total === 0 && subtotal > 0) {
      total = subtotal + impuestos - descuentos;
      warnings.push('Total calculado desde subtotal + impuestos - descuentos');
    }
    if (total < subtotal && impuestos === 0 && descuentos === 0) {
      total = subtotal;
    }

    // ─── 5. Calcular confianza por campo ──────────────────────────
    const confidence = this.calculateConfidence(result, roundedItemsSum);

    return {
      ...result,
      subtotal: Math.round(subtotal * 100) / 100,
      total: Math.round(total * 100) / 100,
      impuestos,
      descuentos: Math.round(descuentos * 100) / 100,
      warnings,
      confidence,
    };
  }

  /**
   * Merge inteligente de múltiples resultados:
   *   - Toma el mejor campo de cada proveedor según confianza.
   *   - Si Azure tiene items estructurados, los compara con los del regex.
   */
  mergeProviderResults(
    regexResult: TicketParseResult,
    providerResults: OcrProviderResult[],
  ): TicketParseResult {
    let merged = { ...regexResult };

    // Buscar resultados con datos estructurados (Azure receipt)
    const structuredResults = providerResults.filter(
      pr => pr.structuredFields.length > 0 || pr.structuredItems.length > 0,
    );

    if (structuredResults.length === 0) {
      return this.reconcile(merged);
    }

    this.logger.log(`[RECONCILE] ${structuredResults.length} proveedores con datos estructurados`);

    for (const sr of structuredResults) {
      // Merge campos escalares si confianza del proveedor es alta
      merged = this.mergeFields(merged, sr);

      // Merge items si el proveedor estructurado tiene más o mejores items
      if (sr.structuredItems.length > 0) {
        merged = this.mergeItems(merged, sr.structuredItems);
      }
    }

    return this.reconcile(merged);
  }

  /**
   * Fusiona campos escalares (tienda, fecha, total, etc.) de un proveedor estructurado.
   */
  private mergeFields(
    current: TicketParseResult,
    provider: OcrProviderResult,
  ): TicketParseResult {
    const updated = { ...current };

    for (const field of provider.structuredFields) {
      if (field.confidence < 0.5) continue; // solo aceptar si confianza alta

      switch (field.name) {
        case 'merchantName':
          if (
            (!current.tienda || current.tienda === 'Tienda desconocida') &&
            field.value
          ) {
            updated.tienda = field.value;
            this.logger.log(`[MERGE] Tienda ← ${provider.provider}: "${field.value}" (conf=${field.confidence})`);
          }
          break;

        case 'merchantAddress':
          if (!current.direccionTienda && field.value) {
            updated.direccionTienda = field.value;
          }
          break;

        case 'transactionDate':
          if (field.value && field.confidence > 0.7) {
            const d = new Date(field.value);
            if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
              updated.fechaCompra = d.toISOString();
              this.logger.log(`[MERGE] Fecha ← ${provider.provider}: "${field.value}"`);
            }
          }
          break;

        case 'subtotal': {
          const val = parseFloat(field.value);
          if (val > 0 && (current.subtotal === 0 || field.confidence > 0.8)) {
            updated.subtotal = val;
          }
          break;
        }

        case 'tax': {
          const val = parseFloat(field.value);
          if (val >= 0 && field.confidence > 0.7) {
            updated.impuestos = val;
            updated.iva = val; // Azure no separa IVA/IEPS
          }
          break;
        }

        case 'total': {
          const val = parseFloat(field.value);
          if (val > 0 && (current.total === 0 || field.confidence > 0.8)) {
            updated.total = val;
          }
          break;
        }

        case 'tip': {
          const val = parseFloat(field.value);
          if (val > 0) {
            updated.propina = val;
          }
          break;
        }
      }
    }

    return updated;
  }

  /**
   * Fusiona items del proveedor estructurado con los del regex.
   * Si el proveedor estructurado tiene más items y su suma es coherente con el total,
   * reemplaza los items del regex.
   */
  private mergeItems(
    current: TicketParseResult,
    structuredItems: StructuredLineItem[],
  ): TicketParseResult {
    const validStructured = structuredItems.filter(
      it => it.description && it.totalPrice > 0 && it.description.length > 1,
    );

    if (validStructured.length === 0) return current;

    const structuredSum = validStructured.reduce((s, it) => s + it.totalPrice, 0);
    const regexSum = current.items.reduce((s, it) => s + it.subtotal, 0);

    // Si los items estructurados son más numerosos y su suma es coherente
    const structuredCoherence = current.total > 0
      ? Math.abs(structuredSum - current.total) / current.total
      : 1;
    const regexCoherence = current.total > 0 && regexSum > 0
      ? Math.abs(regexSum - current.total) / current.total
      : 1;

    if (validStructured.length > current.items.length && structuredCoherence < regexCoherence) {
      this.logger.log(
        `[MERGE] Items ← proveedor estructurado: ${validStructured.length} items (coherencia=${(1 - structuredCoherence).toFixed(2)}) vs regex ${current.items.length} (coherencia=${(1 - regexCoherence).toFixed(2)})`,
      );

      const mergedItems: ParsedItem[] = validStructured.map(it => ({
        nombre: it.description,
        cantidad: it.quantity || 1,
        precioUnitario: it.unitPrice || it.totalPrice,
        subtotal: it.totalPrice,
        categoria: 'otros',
        confianza: it.confidence,
        detalles: [],
      }));

      return { ...current, items: mergedItems };
    }

    return current;
  }

  /**
   * Calcula confianza por campo.
   */
  private calculateConfidence(
    result: TicketParseResult,
    itemsSum: number,
  ): FieldConfidence {
    const tienda =
      result.tienda && result.tienda !== 'Tienda desconocida' ? 0.9 : 0.2;

    let fechaCompra = 0.1;
    if (result.fechaCompra) {
      const d = new Date(result.fechaCompra);
      if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
        fechaCompra = 0.85;
      }
    }

    const itemCount = result.items.length;
    let items = itemCount > 0 ? Math.min(0.9, 0.3 + itemCount * 0.08) : 0.0;
    // Bonus si items sum ≈ subtotal
    if (result.subtotal > 0 && itemsSum > 0) {
      const ratio = itemsSum / result.subtotal;
      if (ratio >= 0.95 && ratio <= 1.05) items = Math.min(items + 0.1, 0.95);
    }

    let subtotalConf = result.subtotal > 0 ? 0.8 : 0.1;
    let totalConf = result.total > 0 ? 0.85 : 0.1;

    // Verificar coherencia total
    if (result.total > 0 && result.subtotal > 0) {
      const expected = result.subtotal + result.impuestos - result.descuentos;
      const diff = Math.abs(expected - result.total);
      if (diff < result.total * 0.02) {
        totalConf = 0.95;
        subtotalConf = 0.9;
      }
    }

    return {
      tienda,
      fechaCompra,
      items,
      subtotal: subtotalConf,
      impuestos: result.impuestos > 0 ? 0.7 : 0.3,
      total: totalConf,
      metodoPago: result.metodoPago ? 0.8 : 0.1,
    };
  }

  /**
   * Determina el nivel de revisión necesario basado en la confianza.
   */
  getReviewLevel(confidence: FieldConfidence): 'auto' | 'light' | 'full' | 'manual' {
    const avg =
      (confidence.tienda + confidence.fechaCompra + confidence.items +
       confidence.subtotal + confidence.total + confidence.metodoPago) / 6;

    if (avg >= 0.85) return 'auto';    // Confirmar automáticamente
    if (avg >= 0.65) return 'light';    // Preview con revisión ligera
    if (avg >= 0.4) return 'full';      // Revisión completa necesaria
    return 'manual';                     // Entrada manual recomendada
  }
}
