import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TotalsExtractor {
  private readonly logger = new Logger(TotalsExtractor.name);

  /**
   * Extrae subtotal, IVA, IEPS, descuento y total del texto del ticket.
   * Soporta peek-ahead para keywords en una línea y valor en la siguiente.
   */
  extract(lines: string[]): {
    total: number;
    subtotal: number;
    iva: number;
    ieps: number;
    descuentos: number;
    impuestos: number;
  } {
    let total = 0;
    let subtotal = 0;
    let iva = 0;
    let ieps = 0;
    let descuentos = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // TOTAL (no SUB-total, no "artículos comprados")
      if (
        /\btotal\b/i.test(line) &&
        !/\bsub\s*total\b/i.test(line) &&
        !/art[ií]culos?/i.test(line) &&
        !/comprados?/i.test(line)
      ) {
        const v = this.getTotalAmount(lines, i, line);
        if (v > 0) {
          total = v;
          this.logger.debug(`[TOTALS] TOTAL=${v} ← "${line}"`);
        }
      }

      // SUBTOTAL
      if (/\bsub\s*total\b/i.test(line)) {
        const v = this.getTotalAmount(lines, i, line);
        if (v > 0) {
          subtotal = v;
          this.logger.debug(`[TOTALS] SUBTOTAL=${v} ← "${line}"`);
        }
      }

      // IVA (ignorar si la misma línea ya tiene "TOTAL")
      if (/\biva\b/i.test(line) && !/^sub/i.test(line) && !/\btotal\b/i.test(line)) {
        const v = this.getTotalAmount(lines, i, line);
        if (v > 0) {
          iva = v;
          this.logger.debug(`[TOTALS] IVA=${v} ← "${line}"`);
        }
      }

      // IEPS
      if (/\bieps\b/i.test(line) && !/\btotal\b/i.test(line)) {
        const v = this.getTotalAmount(lines, i, line);
        if (v > 0) {
          ieps = v;
          this.logger.debug(`[TOTALS] IEPS=${v} ← "${line}"`);
        }
      }

      // DESCUENTO
      if (/\bdescuento\b/i.test(line)) {
        const v = this.getTotalAmount(lines, i, line);
        if (v > 0) {
          descuentos = v;
          this.logger.debug(`[TOTALS] DESCUENTO=${v} ← "${line}"`);
        }
      }
    }

    const impuestos = Math.round((iva + ieps) * 100) / 100;

    this.logger.log(
      `[TOTALS] total=${total} sub=${subtotal} iva=${iva} ieps=${ieps} imp=${impuestos} desc=${descuentos}`,
    );

    return {
      total: Math.round(total * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      iva,
      ieps,
      descuentos: Math.round(descuentos * 100) / 100,
      impuestos,
    };
  }

  /**
   * Extrae el monto de una línea de total.
   * Si la línea tiene un porcentaje (%) y el valor es ≤ 100, busca el monto
   * real en las siguientes líneas (peek-ahead).
   * Si la línea no tiene números, también busca en las siguientes.
   */
  private getTotalAmount(lines: string[], lineIndex: number, lineText: string): number {
    const nums = [...lineText.matchAll(/(\d[\d,]*\.\d+|\d[\d,]{2,})/g)]
      .map((m) => this.parseAmount(m[1]))
      .filter((n) => n > 0);

    if (nums.length > 0) {
      const last = nums[nums.length - 1];
      // Si la línea tiene % y el último número es ≤ 100, es solo un porcentaje
      if (/%/.test(lineText) && last <= 100) {
        return this.peekAhead(lines, lineIndex);
      }
      return last;
    }

    // Sin números en esta línea → buscar en la siguiente
    return this.peekAhead(lines, lineIndex);
  }

  /** Busca un monto en las siguientes 2 líneas */
  private peekAhead(lines: string[], fromIndex: number): number {
    for (let j = fromIndex + 1; j < Math.min(fromIndex + 3, lines.length); j++) {
      const nextNums = [...lines[j].matchAll(/(\d[\d,]*\.\d{2})/g)]
        .map((m) => this.parseAmount(m[1]))
        .filter((n) => n > 0);
      if (nextNums.length > 0) return nextNums[nextNums.length - 1];
    }
    return 0;
  }

  private parseAmount(str: string): number {
    return Number(str.replace(/,/g, '')) || 0;
  }
}
