import { Injectable, Logger } from '@nestjs/common';

/**
 * Analizador estructural de tickets OCR.
 *
 * Examina el texto crudo de un ticket para identificar:
 *   - Zonas (header, items, totales, footer)
 *   - Formato de líneas de items
 *   - Patrones de totales
 *   - Formato de fecha
 *   - Líneas de exclusión recurrentes
 *   - Palabras clave del header/footer
 */

export interface StructuralFingerprint {
  /** Número total de líneas */
  lineCount: number;
  /** Zonas detectadas con su rango porcentual */
  zones: Array<{ zone: string; startPct: number; endPct: number; patterns: string[]; keywords: string[] }>;
  /** Formatos de línea que matchean items */
  itemFormats: Array<{ name: string; regex: string; matchCount: number; matchRate: number }>;
  /** Patrones de totales detectados */
  totalPatterns: Array<{ field: string; labels: string[]; positionFromBottom: number }>;
  /** Formatos de fecha encontrados */
  dateFormats: string[];
  /** Keywords del header */
  headerKeywords: string[];
  /** Keywords del footer */
  footerKeywords: string[];
  /** Líneas de exclusión (separadores, publicidad) */
  excludePatterns: string[];
  /** Secciones de categoría (ABARROTES, CARNES) */
  sectionHeaders: Array<{ pattern: string; categoria: string }>;
  /** Sufijos de impuestos detectados */
  taxSuffixes: string[];
}

// ─── Formato de items conocidos ────────────────────────────────
const ITEM_FORMAT_DEFS = [
  {
    name: 'qty_x_price',
    regex: String.raw`^(.+?)\s+(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s+\$?(\d+(?:,\d{3})*(?:\.\d{2}))\s*[TECAM]?\s*$`,
    description: 'NOMBRE  QTY x PRECIO  TOTAL[T]',
  },
  {
    name: 'name_price_suffix',
    regex: String.raw`^(.{3,}?)\s{2,}\$?(\d+(?:,\d{3})*(?:\.\d{2}))\s*[TECAM]\s*$`,
    description: 'NOMBRE  PRECIO T/E/C/A/M',
  },
  {
    name: 'name_price_simple',
    regex: String.raw`^(.{3,}?)\s{2,}\$?(\d+(?:,\d{3})*(?:\.\d{2}))\s*$`,
    description: 'NOMBRE  PRECIO (sin sufijo)',
  },
  {
    name: 'restaurant_qty_code_name',
    regex: String.raw`^\s*(\d{1,2})\s+([A-Z]{1,4})\s+(.+?)\s+\$?(\d+(?:,\d{3})*(?:\.\d{2}))\s*$`,
    description: 'QTY CODE NOMBRE PRECIO',
  },
  {
    name: 'barcode_name',
    regex: String.raw`^\s*(\d{10,13})\s+(.+?)\s+\$?(\d+(?:,\d{3})*(?:\.\d{2}))\s*$`,
    description: 'BARCODE NOMBRE PRECIO',
  },
  {
    name: 'loose_name_price',
    regex: String.raw`^(.{3,}?)\s+\$?(\d+(?:,\d{3})*\.\d{2})\s*$`,
    description: 'NOMBRE PRECIO (1 espacio mínimo)',
  },
];

// ─── Total keywords por campo ──────────────────────────────────
const TOTAL_FIELD_PATTERNS: Array<{ field: string; patterns: RegExp[] }> = [
  { field: 'subtotal', patterns: [/sub\s*total/i, /sub-total/i, /subtotal/i] },
  { field: 'total', patterns: [/^total\b/i, /\btotal\s*[:$]/i, /importe\s+total/i] },
  { field: 'iva', patterns: [/\biva\b/i, /i\.?\s*v\.?\s*a\.?\b/i, /\b16\s*%/] },
  { field: 'ieps', patterns: [/\bieps\b/i, /i\.?\s*e\.?\s*p\.?\s*s/i] },
  { field: 'descuento', patterns: [/descuento/i, /ahorro/i, /rebaja/i, /bonificaci/i] },
  { field: 'propina', patterns: [/propina/i, /tip/i] },
];

// ─── Secciones de supermercado ─────────────────────────────────
const SECTION_DEFS: Array<{ pattern: RegExp; categoria: string }> = [
  { pattern: /abarrotes?\s*(procesados?)?/i, categoria: 'alimentos' },
  { pattern: /carnes?/i, categoria: 'alimentos' },
  { pattern: /l[aá]cteos?/i, categoria: 'alimentos' },
  { pattern: /bebidas?/i, categoria: 'alimentos' },
  { pattern: /frutas?\s*(y\s*)?verduras?/i, categoria: 'alimentos' },
  { pattern: /panader[ií]a/i, categoria: 'alimentos' },
  { pattern: /jardiner[ií]a/i, categoria: 'hogar' },
  { pattern: /ferreter[ií]a/i, categoria: 'hogar' },
  { pattern: /limpieza/i, categoria: 'higiene' },
  { pattern: /cosm[eé]ticos?|belleza/i, categoria: 'higiene' },
  { pattern: /farmacia/i, categoria: 'farmacia' },
  { pattern: /ropa/i, categoria: 'ropa' },
  { pattern: /electr[oó]n/i, categoria: 'tecnologia' },
  { pattern: /mascotas?/i, categoria: 'mascotas' },
];

// ─── Date format patterns ──────────────────────────────────────
const DATE_FORMAT_DEFS = [
  { name: 'DD/MM/YYYY', pattern: /\b\d{2}\/\d{2}\/\d{4}\b/ },
  { name: 'DD-MM-YYYY', pattern: /\b\d{2}-\d{2}-\d{4}\b/ },
  { name: 'YYYY-MM-DD', pattern: /\b\d{4}-\d{2}-\d{2}\b/ },
  { name: 'DDMonYY', pattern: /\b\d{2}\s*[A-Z]{3}\s*['']?\d{2}\b/i },
  { name: 'DD/MM/YY', pattern: /\b\d{2}\/\d{2}\/\d{2}\b/ },
];

@Injectable()
export class StructureAnalyzer {
  private readonly logger = new Logger(StructureAnalyzer.name);

  /**
   * Analiza el texto OCR crudo y genera un fingerprint estructural del ticket.
   */
  analyze(rawText: string): StructuralFingerprint {
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const lineCount = lines.length;

    if (lineCount === 0) {
      return this.emptyFingerprint();
    }

    const zones = this.detectZones(lines);
    const itemFormats = this.detectItemFormats(lines);
    const totalPatterns = this.detectTotalPatterns(lines);
    const dateFormats = this.detectDateFormats(lines);
    const headerKeywords = this.extractHeaderKeywords(lines);
    const footerKeywords = this.extractFooterKeywords(lines);
    const excludePatterns = this.detectExcludePatterns(lines);
    const sectionHeaders = this.detectSections(lines);
    const taxSuffixes = this.detectTaxSuffixes(lines);

    return {
      lineCount,
      zones,
      itemFormats,
      totalPatterns,
      dateFormats,
      headerKeywords,
      footerKeywords,
      excludePatterns,
      sectionHeaders,
      taxSuffixes,
    };
  }

  // ─── Zonas ───────────────────────────────────────────────────

  private detectZones(lines: string[]) {
    const n = lines.length;
    const zones: StructuralFingerprint['zones'] = [];

    // Header: primeras 15-20% de líneas (logo, nombre, dirección, RFC)
    const headerEnd = Math.min(Math.ceil(n * 0.2), 12);
    zones.push({
      zone: 'header',
      startPct: 0,
      endPct: Math.round((headerEnd / n) * 100),
      patterns: this.extractZonePatterns(lines.slice(0, headerEnd)),
      keywords: this.extractZoneKeywords(lines.slice(0, headerEnd)),
    });

    // Footer: últimas 15-20% de líneas (totales, pago, publicidad)
    const footerStart = Math.max(Math.floor(n * 0.8), n - 15);
    zones.push({
      zone: 'footer',
      startPct: Math.round((footerStart / n) * 100),
      endPct: 100,
      patterns: this.extractZonePatterns(lines.slice(footerStart)),
      keywords: this.extractZoneKeywords(lines.slice(footerStart)),
    });

    // Items: zona entre header y totales
    const totalsStart = this.findTotalsStart(lines);
    zones.push({
      zone: 'items',
      startPct: Math.round((headerEnd / n) * 100),
      endPct: Math.round(((totalsStart || footerStart) / n) * 100),
      patterns: [],
      keywords: [],
    });

    // Totals: zona antes del footer donde aparecen subtotal/total
    if (totalsStart) {
      zones.push({
        zone: 'totals',
        startPct: Math.round((totalsStart / n) * 100),
        endPct: Math.round((footerStart / n) * 100),
        patterns: this.extractZonePatterns(lines.slice(totalsStart, footerStart)),
        keywords: this.extractZoneKeywords(lines.slice(totalsStart, footerStart)),
      });
    }

    return zones;
  }

  private findTotalsStart(lines: string[]): number | null {
    // Buscar de abajo hacia arriba la primera línea de total
    for (let i = lines.length - 1; i >= Math.floor(lines.length * 0.5); i--) {
      if (/sub\s*total/i.test(lines[i]) || /^total\b/i.test(lines[i])) {
        return i;
      }
    }
    return null;
  }

  private extractZonePatterns(zoneLines: string[]): string[] {
    const patterns: string[] = [];
    for (const line of zoneLines) {
      // Líneas con separadores
      if (/^[-=*\.★─]{3,}$/.test(line)) {
        patterns.push('separator');
      }
      // RFC
      if (/r\.?f\.?c\.?\s/i.test(line)) {
        patterns.push('rfc');
      }
      // Dirección
      if (/^(av\.?|calle|blvd\.?|col\.?|c\.p\.?)\s/i.test(line)) {
        patterns.push('address');
      }
    }
    return [...new Set(patterns)];
  }

  private extractZoneKeywords(zoneLines: string[]): string[] {
    const words: string[] = [];
    for (const line of zoneLines) {
      // Extraer palabras significativas (>3 chars, no números puros)
      const tokens = line.split(/\s+/).filter(t =>
        t.length > 3 && !/^\d+$/.test(t) && !/^[-=*\.★─]+$/.test(t),
      );
      for (const t of tokens) {
        words.push(t.toLowerCase().replace(/[^a-záéíóúñü]/gi, ''));
      }
    }
    // Contar frecuencia y devolver las top 10
    const freq: Record<string, number> = {};
    for (const w of words) {
      if (w.length < 3) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  // ─── Item formats ────────────────────────────────────────────

  private detectItemFormats(lines: string[]) {
    const results: StructuralFingerprint['itemFormats'] = [];

    for (const def of ITEM_FORMAT_DEFS) {
      const re = new RegExp(def.regex);
      let matchCount = 0;
      for (const line of lines) {
        if (re.test(line)) matchCount++;
      }
      if (matchCount > 0) {
        results.push({
          name: def.name,
          regex: def.regex,
          matchCount,
          matchRate: matchCount / lines.length,
        });
      }
    }

    // Ordenar por matchCount descendente
    results.sort((a, b) => b.matchCount - a.matchCount);
    return results;
  }

  // ─── Total patterns ──────────────────────────────────────────

  private detectTotalPatterns(lines: string[]) {
    const results: StructuralFingerprint['totalPatterns'] = [];
    const n = lines.length;

    for (let i = 0; i < n; i++) {
      const line = lines[i];
      for (const def of TOTAL_FIELD_PATTERNS) {
        if (def.patterns.some(p => p.test(line))) {
          // Extraer las labels literales de la línea
          const labels = [line.replace(/\$?\d+[\d,]*\.?\d*/g, '').trim()];
          results.push({
            field: def.field,
            labels: labels.filter(l => l.length > 0),
            positionFromBottom: Math.round(((n - i) / n) * 100),
          });
          break; // una línea solo matchea un campo
        }
      }
    }

    return results;
  }

  // ─── Date formats ────────────────────────────────────────────

  private detectDateFormats(lines: string[]) {
    const found: string[] = [];
    const text = lines.join(' ');
    for (const def of DATE_FORMAT_DEFS) {
      if (def.pattern.test(text)) {
        found.push(def.name);
      }
    }
    return found;
  }

  // ─── Header / Footer keywords ────────────────────────────────

  private extractHeaderKeywords(lines: string[]): string[] {
    const headerLines = lines.slice(0, Math.min(8, lines.length));
    return this.extractZoneKeywords(headerLines);
  }

  private extractFooterKeywords(lines: string[]): string[] {
    const footerLines = lines.slice(Math.max(0, lines.length - 10));
    return this.extractZoneKeywords(footerLines);
  }

  // ─── Exclude patterns ────────────────────────────────────────

  private detectExcludePatterns(lines: string[]): string[] {
    const excludes: string[] = [];

    for (const line of lines) {
      // Separadores
      if (/^[-=*\.★─]{5,}$/.test(line)) {
        excludes.push(line.substring(0, 20));
      }
      // Publicidad / mensajes genéricos
      if (/gracias\s+por/i.test(line) || /aviso\s+de\s+privacidad/i.test(line)) {
        excludes.push(line.substring(0, 60));
      }
    }

    return [...new Set(excludes)];
  }

  // ─── Section headers ─────────────────────────────────────────

  private detectSections(lines: string[]) {
    const found: Array<{ pattern: string; categoria: string }> = [];

    for (const line of lines) {
      for (const def of SECTION_DEFS) {
        if (def.pattern.test(line) && line.length < 30) {
          found.push({
            pattern: line.trim(),
            categoria: def.categoria,
          });
          break;
        }
      }
    }

    return found;
  }

  // ─── Tax suffixes ────────────────────────────────────────────

  private detectTaxSuffixes(lines: string[]): string[] {
    const suffixes = new Set<string>();

    for (const line of lines) {
      // Match trailing single letter suffixes after price (T, E, C, A, M)
      const match = line.match(/\d+\.\d{2}\s*([TECAM])\s*$/);
      if (match) {
        suffixes.add(match[1]);
      }
    }

    return [...suffixes];
  }

  // ─── Empty fingerprint ───────────────────────────────────────

  private emptyFingerprint(): StructuralFingerprint {
    return {
      lineCount: 0,
      zones: [],
      itemFormats: [],
      totalPatterns: [],
      dateFormats: [],
      headerKeywords: [],
      footerKeywords: [],
      excludePatterns: [],
      sectionHeaders: [],
      taxSuffixes: [],
    };
  }
}
