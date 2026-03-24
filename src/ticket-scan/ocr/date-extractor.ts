import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DateExtractor {
  private readonly logger = new Logger(DateExtractor.name);

  private readonly monthMap: Record<string, number> = {
    ene: 0, jan: 0, feb: 1, mar: 2, abr: 3, apr: 3, may: 4, jun: 5,
    jul: 6, ago: 7, aug: 7, sep: 8, oct: 9, nov: 10, dic: 11, dec: 11,
  };

  /**
   * Extrae la fecha de compra del texto del ticket.
   * Soporta: DDMon'YY, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
   */
  extract(lines: string[]): string {
    for (const line of lines) {
      // DDMon'YY  (e.g. "15Mar'26", "15Mar26", "15 Mar '26")
      const mAlpha = line.match(
        /(\d{1,2})\s*(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic|jan|apr|aug|dec)[a-z]*['\u2019\u00b4]?\s*(\d{2,4})/i,
      );
      if (mAlpha) {
        const day = Number(mAlpha[1]);
        const mo = this.monthMap[mAlpha[2].toLowerCase().substring(0, 3)];
        let yr = Number(mAlpha[3]);
        if (yr < 100) yr += 2000;
        if (mo !== undefined && day >= 1 && day <= 31 && yr >= 2020 && yr <= 2035) {
          const date = new Date(yr, mo, day, 12, 0, 0).toISOString();
          this.logger.debug(`[DATE] Fecha alpha: ${date} ← "${line}"`);
          return date;
        }
      }

      // DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY or YYYY-MM-DD
      const dateRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/;
      const m = line.match(dateRegex);
      if (m) {
        const d = this.parseTicketDate(m[1]);
        if (d && d.getFullYear() >= 2020 && d.getFullYear() <= 2035) {
          const date = d.toISOString();
          this.logger.debug(`[DATE] Fecha numérica: ${date} ← "${line}"`);
          return date;
        }
      }
    }

    return new Date().toISOString();
  }

  private parseTicketDate(str: string): Date | null {
    // DD/MM/YYYY or DD-MM-YYYY
    let match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (match) {
      const day = Number(match[1]);
      const month = Number(match[2]) - 1;
      let year = Number(match[3]);
      if (year < 100) year += 2000;
      return new Date(year, month, day, 12, 0, 0);
    }
    // YYYY-MM-DD
    match = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
    }
    return null;
  }
}
