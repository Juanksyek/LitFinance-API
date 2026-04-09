import { Injectable, Logger } from '@nestjs/common';

/**
 * Analizador estructural de tickets OCR — ROBUSTO.
 *
 * Examina el texto crudo de un ticket para identificar:
 *   - Zonas (header, items, totales, footer) con rangos precisos
 *   - Formatos de líneas de items (14 patrones, tolerante a ruido OCR)
 *   - Patrones de totales con hitCount
 *   - Formatos de fecha (7 variantes)
 *   - Posición de columna de precios (ancho fijo vs variable)
 *   - Items multi-línea (nombre en una línea, precio en otra)
 *   - Separadores entre nombre y precio
 *   - Líneas de exclusión con categorización
 *   - Secciones de supermercado (16 categorías)
 *   - Sufijos fiscales con frecuencia
 *   - Clasificación de cada línea (item, total, exclude, separator, header, footer)
 */

// ═════════════════════════════════════════════════════════════════
// TIPOS
// ═════════════════════════════════════════════════════════════════

export interface StructuralFingerprint {
  lineCount: number;
  zones: Array<{ zone: string; startPct: number; endPct: number; patterns: string[]; keywords: string[] }>;
  itemFormats: Array<{ name: string; regex: string; matchCount: number; matchRate: number }>;
  totalPatterns: Array<{ field: string; labels: string[]; positionFromBottom: number }>;
  dateFormats: string[];
  headerKeywords: string[];
  footerKeywords: string[];
  excludePatterns: string[];
  sectionHeaders: Array<{ pattern: string; categoria: string }>;
  taxSuffixes: string[];
  /** Nueva: info de posición de precios */
  priceColumn: { avgPositionPct: number; isFixedColumn: boolean; minCharPos: number; separator: string } | null;
  /** Nueva: cantidad estimada de líneas de items */
  itemLineCount: number;
  /** Nueva: items detectados (cantidad) */
  estimatedItemCount: number;
  /** Nueva: clasificación de cada línea */
  lineClassification: Array<{ index: number; type: LineType; confidence: number }>;
  /** Nueva: si tiene items multi-línea (nombre en una línea, precio en otra) */
  hasMultiLineItems: boolean;
  /** Nueva: caracteres de separación detectados entre nombre y precio */
  separatorChars: string[];
}

export type LineType = 'header' | 'item' | 'total' | 'exclude' | 'separator' | 'footer' | 'section' | 'unknown';

// ═════════════════════════════════════════════════════════════════
// FORMATOS DE ITEMS — 14 patrones con tolerancia a ruido OCR
// ═════════════════════════════════════════════════════════════════

const ITEM_FORMAT_DEFS = [
  {
    name: 'qty_x_price',
    regex: String.raw`^(.+?)\s+(\d+(?:\.\d+)?)\s*[xX×]\s*\$?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s+\$?\s*(\d+(?:,\d{3})*(?:\.\d{2}))\s*[TECAM]?\s*$`,
    description: 'NOMBRE  QTY x PRECIO  SUBTOTAL[T]',
  },
  {
    name: 'qty_x_price_leading',
    regex: String.raw`^\s*(\d+(?:\.\d{1,3})?)\s*[xX×]\s*\$?\s*(\d+(?:,\d{3})*\.\d{2})\s+(.+?)\s+\$?\s*(\d+(?:,\d{3})*\.\d{2})\s*[TECAM]?\s*$`,
    description: 'QTY x PRECIO  NOMBRE  SUBTOTAL[T]',
  },
  {
    name: 'name_price_suffix',
    regex: String.raw`^(.{3,}?)\s{2,}\$?\s*(\d+(?:,\d{3})*\.\d{2})\s*[TECAM]\s*$`,
    description: 'NOMBRE  PRECIO T/E/C/A/M',
  },
  {
    name: 'name_price_simple',
    regex: String.raw`^(.{3,}?)\s{2,}\$?\s*(\d+(?:,\d{3})*\.\d{2})\s*$`,
    description: 'NOMBRE  PRECIO (sin sufijo)',
  },
  {
    name: 'qty_name_price',
    regex: String.raw`^\s*(\d{1,3})\s+(.{3,}?)\s{2,}\$?\s*(\d+(?:,\d{3})*\.\d{2})\s*[TECAM]?\s*$`,
    description: 'QTY NOMBRE  PRECIO[T]',
  },
  {
    name: 'name_qty_at_price',
    regex: String.raw`^(.{3,}?)\s+(\d+(?:\.\d{1,3})?)\s*@\s*\$?\s*(\d+(?:,\d{3})*\.\d{2})\s+\$?\s*(\d+(?:,\d{3})*\.\d{2})\s*$`,
    description: 'NOMBRE  QTY @ PRECIO  SUBTOTAL',
  },
  {
    name: 'restaurant_qty_code_name',
    regex: String.raw`^\s*(\d{1,2})\s+([A-Z]{1,4})\s+(.+?)\s+\$?\s*(\d+(?:,\d{3})*\.\d{2})\s*$`,
    description: 'QTY CODE NOMBRE PRECIO',
  },
  {
    name: 'restaurant_qty_name',
    regex: String.raw`^\s*(\d{1,2})\s+(.{3,}?)\s{2,}\$?\s*(\d+(?:,\d{3})*\.\d{2})\s*$`,
    description: 'QTY NOMBRE  PRECIO (restaurante)',
  },
  {
    name: 'barcode_name',
    regex: String.raw`^\s*(\d{10,13})\s+(.+?)\s+\$?\s*(\d+(?:,\d{3})*\.\d{2})\s*[TECAM]?\s*$`,
    description: 'BARCODE NOMBRE PRECIO[T]',
  },
  {
    name: 'barcode_then_name_price',
    regex: String.raw`^\s*(\d{10,13})\s*$`,
    description: 'Solo barcode (nombre/precio en siguiente línea)',
  },
  {
    name: 'dots_separator',
    regex: String.raw`^(.{3,}?)\.{2,}\s*\$?\s*(\d+(?:,\d{3})*\.\d{2})\s*$`,
    description: 'NOMBRE....PRECIO (separado por puntos)',
  },
  {
    name: 'dashes_separator',
    regex: String.raw`^(.{3,}?)-{2,}\s*\$?\s*(\d+(?:,\d{3})*\.\d{2})\s*$`,
    description: 'NOMBRE---PRECIO (separado por guiones)',
  },
  {
    name: 'tabular_fixed',
    regex: String.raw`^(.{10,30})\s*(\d+(?:\.\d{1,3})?)\s+(\d+(?:,\d{3})*\.\d{2})\s+(\d+(?:,\d{3})*\.\d{2})\s*[TECAM]?\s*$`,
    description: 'NOMBRE(fijo)  QTY  UNITARIO  SUBTOTAL[T]',
  },
  {
    name: 'loose_name_price',
    regex: String.raw`^(.{3,}?)\s+\$?\s*(\d+(?:,\d{3})*\.\d{2})\s*$`,
    description: 'NOMBRE PRECIO (1 espacio mínimo, fallback)',
  },
];

// ─── Total keywords por campo ──────────────────────────────────
const TOTAL_FIELD_PATTERNS: Array<{ field: string; patterns: RegExp[] }> = [
  { field: 'subtotal', patterns: [/sub\s*-?\s*total/i, /sub-total/i, /subtotal/i, /importe\s*neto/i] },
  { field: 'total', patterns: [/^total\b/i, /\btotal\s*[:$]/i, /importe\s+total/i, /total\s+a\s+pagar/i, /\btotal\s*venta/i] },
  { field: 'iva', patterns: [/\biva\b/i, /i\.?\s*v\.?\s*a\.?\b/i, /\b16\s*%/, /impuesto.*16/i] },
  { field: 'ieps', patterns: [/\bieps\b/i, /i\.?\s*e\.?\s*p\.?\s*s/i, /impuesto.*espec/i] },
  { field: 'descuento', patterns: [/descuento/i, /ahorro/i, /rebaja/i, /bonificaci/i, /dcto/i, /desc\./i] },
  { field: 'propina', patterns: [/propina/i, /tip\b/i, /servicio\s+%/i] },
  { field: 'cambio', patterns: [/cambio/i, /su\s+cambio/i] },
  { field: 'efectivo', patterns: [/efectivo/i, /pago.*efectivo/i] },
  { field: 'tarjeta', patterns: [/tarjeta/i, /t\.?\s*d\.?\s*[cd]/i, /visa|master|amex/i] },
];

// ─── Secciones de supermercado (16) ────────────────────────────
const SECTION_DEFS: Array<{ pattern: RegExp; categoria: string }> = [
  { pattern: /abarrotes?\s*(procesados?)?/i, categoria: 'alimentos' },
  { pattern: /carnes?\s*(fr[ií]as?)?/i, categoria: 'alimentos' },
  { pattern: /l[aá]cteos?/i, categoria: 'alimentos' },
  { pattern: /bebidas?/i, categoria: 'alimentos' },
  { pattern: /frutas?\s*(y\s*)?verduras?/i, categoria: 'alimentos' },
  { pattern: /panader[ií]a/i, categoria: 'alimentos' },
  { pattern: /salchichoner[ií]a|deli/i, categoria: 'alimentos' },
  { pattern: /congelados?/i, categoria: 'alimentos' },
  { pattern: /jardiner[ií]a/i, categoria: 'hogar' },
  { pattern: /ferreter[ií]a|herramientas?/i, categoria: 'hogar' },
  { pattern: /limpieza|detergentes?/i, categoria: 'higiene' },
  { pattern: /cosm[eé]ticos?|belleza|cuidado\s+personal/i, categoria: 'higiene' },
  { pattern: /farmacia|medicamentos?/i, categoria: 'farmacia' },
  { pattern: /ropa|textil/i, categoria: 'ropa' },
  { pattern: /electr[oó]n|tecnolog/i, categoria: 'tecnologia' },
  { pattern: /mascotas?|veterinar/i, categoria: 'mascotas' },
];

// ─── Date format patterns (7) ──────────────────────────────────
const DATE_FORMAT_DEFS = [
  { name: 'DD/MM/YYYY', pattern: /\b\d{2}\/\d{2}\/\d{4}\b/ },
  { name: 'DD-MM-YYYY', pattern: /\b\d{2}-\d{2}-\d{4}\b/ },
  { name: 'YYYY-MM-DD', pattern: /\b\d{4}-\d{2}-\d{2}\b/ },
  { name: 'DDMonYY', pattern: /\b\d{2}\s*[A-Z]{3}\s*['']?\d{2}\b/i },
  { name: 'DD/MM/YY', pattern: /\b\d{2}\/\d{2}\/\d{2}\b/ },
  { name: 'DD.MM.YYYY', pattern: /\b\d{2}\.\d{2}\.\d{4}\b/ },
  { name: 'Mon DD, YYYY', pattern: /\b[A-Z]{3}\s+\d{1,2},?\s+\d{4}\b/i },
];

// ─── Exclude patterns (líneas a filtrar) ───────────────────────
const EXCLUDE_LINE_PATTERNS: RegExp[] = [
  /^[-=*\.★─·]{3,}$/,              // separadores puros
  /gracias\s+por/i,
  /aviso\s+de\s+privacidad/i,
  /r\.?f\.?c\.?\s/i,
  /^s\.?\s*a\.?\s*de\s*c\.?\s*v/i,
  /afiliaci[oó]n\s*:/i,
  /autorizaci[oó]n\s*:/i,
  /^aid\s*:/i,
  /^store\s*#/i,
  /venta\s+en\s+l[ií]nea/i,
  /folio\s*:/i,
  /^\s*(caja|cajero|sucursal|tienda\s*#|terminal)\b/i,
  /^\s*tel[eé]fono\s*:/i,
  /^\s*\d{2}:\d{2}:\d{2}\s*$/,     // solo hora
  /factura\s+electr[oó]nica/i,
  /^www\./i,
  /^\s*http/i,
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

    if (lineCount === 0) return this.emptyFingerprint();

    // Clasificar cada línea primero (base para todo lo demás)
    const lineClassification = this.classifyAllLines(lines);

    const zones = this.detectZones(lines, lineClassification);
    const itemFormats = this.detectItemFormats(lines, lineClassification);
    const totalPatterns = this.detectTotalPatterns(lines);
    const dateFormats = this.detectDateFormats(lines);
    const headerKeywords = this.extractHeaderKeywords(lines);
    const footerKeywords = this.extractFooterKeywords(lines);
    const excludePatterns = this.detectExcludePatterns(lines);
    const sectionHeaders = this.detectSections(lines);
    const taxSuffixes = this.detectTaxSuffixes(lines);
    const priceColumn = this.detectPriceColumn(lines, lineClassification);
    const hasMultiLineItems = this.detectMultiLineItems(lines, lineClassification);
    const separatorChars = this.detectSeparatorChars(lines);

    const itemLines = lineClassification.filter(l => l.type === 'item');
    const estimatedItemCount = itemLines.length;

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
      priceColumn,
      itemLineCount: itemLines.length,
      estimatedItemCount,
      lineClassification,
      hasMultiLineItems,
      separatorChars,
    };
  }

  // ═════════════════════════════════════════════════════════════════
  // CLASIFICACIÓN DE LÍNEAS — el corazón del análisis robusto
  // ═════════════════════════════════════════════════════════════════

  private classifyAllLines(lines: string[]): StructuralFingerprint['lineClassification'] {
    const n = lines.length;
    const result: StructuralFingerprint['lineClassification'] = [];

    for (let i = 0; i < n; i++) {
      const line = lines[i];
      const pct = n > 0 ? (i / n) * 100 : 0;

      // 1. Separadores
      if (/^[-=*\.★─·]{3,}$/.test(line)) {
        result.push({ index: i, type: 'separator', confidence: 0.95 });
        continue;
      }

      // 2. Secciones
      if (SECTION_DEFS.some(s => s.pattern.test(line)) && line.length < 35) {
        result.push({ index: i, type: 'section', confidence: 0.85 });
        continue;
      }

      // 3. Totales / pago
      if (this.isTotalLine(line)) {
        result.push({ index: i, type: 'total', confidence: 0.9 });
        continue;
      }

      // 4. Líneas de exclusión
      if (EXCLUDE_LINE_PATTERNS.some(p => p.test(line))) {
        result.push({ index: i, type: 'exclude', confidence: 0.85 });
        continue;
      }

      // 5. Header (primeros 20%)
      if (pct < 20 && !this.looksLikeItem(line)) {
        result.push({ index: i, type: 'header', confidence: 0.7 });
        continue;
      }

      // 6. Footer (últimos 15%)
      if (pct > 85 && !this.looksLikeItem(line)) {
        result.push({ index: i, type: 'footer', confidence: 0.6 });
        continue;
      }

      // 7. Items — tiene un precio al final
      if (this.looksLikeItem(line)) {
        result.push({ index: i, type: 'item', confidence: 0.8 });
        continue;
      }

      // 8. Unknown
      result.push({ index: i, type: 'unknown', confidence: 0.3 });
    }

    return result;
  }

  private isTotalLine(line: string): boolean {
    return TOTAL_FIELD_PATTERNS.some(tf => tf.patterns.some(p => p.test(line)));
  }

  private looksLikeItem(line: string): boolean {
    // Un item típicamente tiene: texto + precio al final
    if (line.length < 5) return false;
    // Precio al final: $123.45 o 123.45 opcionalmente con sufijo fiscal
    if (/\$?\s*\d+(?:,\d{3})*\.\d{2}\s*[TECAM]?\s*$/.test(line)) {
      // No es un total
      if (!this.isTotalLine(line)) return true;
    }
    return false;
  }

  // ═════════════════════════════════════════════════════════════════
  // ZONAS — con clasificación de líneas como base
  // ═════════════════════════════════════════════════════════════════

  private detectZones(
    lines: string[],
    classification: StructuralFingerprint['lineClassification'],
  ) {
    const n = lines.length;
    const zones: StructuralFingerprint['zones'] = [];

    // Header: desde inicio hasta primera línea de item
    const firstItem = classification.find(c => c.type === 'item');
    const headerEnd = firstItem ? firstItem.index : Math.min(Math.ceil(n * 0.2), 12);
    zones.push({
      zone: 'header',
      startPct: 0,
      endPct: Math.round((headerEnd / n) * 100),
      patterns: this.extractZonePatterns(lines.slice(0, headerEnd)),
      keywords: this.extractZoneKeywords(lines.slice(0, headerEnd)),
    });

    // Totals: primera línea tipo 'total' hasta fin de totales
    const totalLines = classification.filter(c => c.type === 'total');
    const totalsStart = totalLines.length > 0 ? totalLines[0].index : null;
    const totalsEnd = totalLines.length > 0 ? totalLines[totalLines.length - 1].index + 1 : null;

    // Items: desde headerEnd hasta totalsStart (o footerStart)
    const lastItem = [...classification].reverse().find(c => c.type === 'item');
    const itemsEnd = totalsStart ?? (lastItem ? lastItem.index + 1 : Math.floor(n * 0.8));
    zones.push({
      zone: 'items',
      startPct: Math.round((headerEnd / n) * 100),
      endPct: Math.round((itemsEnd / n) * 100),
      patterns: [],
      keywords: [],
    });

    if (totalsStart !== null && totalsEnd !== null) {
      zones.push({
        zone: 'totals',
        startPct: Math.round((totalsStart / n) * 100),
        endPct: Math.round((totalsEnd / n) * 100),
        patterns: this.extractZonePatterns(lines.slice(totalsStart, totalsEnd)),
        keywords: this.extractZoneKeywords(lines.slice(totalsStart, totalsEnd)),
      });
    }

    // Footer: después de totales/último item
    const footerStart = totalsEnd ?? itemsEnd;
    if (footerStart < n) {
      zones.push({
        zone: 'footer',
        startPct: Math.round((footerStart / n) * 100),
        endPct: 100,
        patterns: this.extractZonePatterns(lines.slice(footerStart)),
        keywords: this.extractZoneKeywords(lines.slice(footerStart)),
      });
    }

    return zones;
  }

  // ═════════════════════════════════════════════════════════════════
  // FORMATOS DE ITEMS — con pre-filtrado por clasificación
  // ═════════════════════════════════════════════════════════════════

  private detectItemFormats(
    lines: string[],
    classification: StructuralFingerprint['lineClassification'],
  ) {
    const results: StructuralFingerprint['itemFormats'] = [];

    // Solo analizar líneas clasificadas como item o unknown (no totales, headers, etc.)
    const candidateIndices = new Set(
      classification
        .filter(c => c.type === 'item' || c.type === 'unknown')
        .map(c => c.index),
    );
    const candidateLines = lines.filter((_, i) => candidateIndices.has(i));

    if (candidateLines.length === 0) return results;

    for (const def of ITEM_FORMAT_DEFS) {
      const re = new RegExp(def.regex);
      let matchCount = 0;
      for (const line of candidateLines) {
        if (re.test(line)) matchCount++;
      }
      if (matchCount > 0) {
        results.push({
          name: def.name,
          regex: def.regex,
          matchCount,
          matchRate: matchCount / candidateLines.length,
        });
      }
    }

    results.sort((a, b) => b.matchCount - a.matchCount);
    return results;
  }

  // ═════════════════════════════════════════════════════════════════
  // POSICIÓN DE PRECIOS — detecta si el ticket usa columna fija
  // ═════════════════════════════════════════════════════════════════

  private detectPriceColumn(
    lines: string[],
    classification: StructuralFingerprint['lineClassification'],
  ): StructuralFingerprint['priceColumn'] {
    const pricePositions: number[] = [];
    const lineWidths: number[] = [];
    const separators: Record<string, number> = { spaces: 0, dots: 0, dashes: 0, tabs: 0 };

    for (const cls of classification) {
      if (cls.type !== 'item') continue;
      const line = lines[cls.index];
      const match = line.match(/(\$?\s*\d+(?:,\d{3})*\.\d{2})\s*[TECAM]?\s*$/);
      if (match && match.index !== undefined) {
        pricePositions.push(match.index);
        lineWidths.push(line.length);

        // Detectar separador
        const beforePrice = line.substring(0, match.index);
        if (/\.{2,}\s*$/.test(beforePrice)) separators.dots++;
        else if (/-{2,}\s*$/.test(beforePrice)) separators.dashes++;
        else if (/\t/.test(beforePrice)) separators.tabs++;
        else separators.spaces++;
      }
    }

    if (pricePositions.length < 2) return null;

    const avgPos = pricePositions.reduce((a, b) => a + b, 0) / pricePositions.length;
    const avgWidth = lineWidths.reduce((a, b) => a + b, 0) / lineWidths.length;
    const variance = pricePositions.reduce((sum, p) => sum + Math.pow(p - avgPos, 2), 0) / pricePositions.length;
    const stdDev = Math.sqrt(variance);

    // Si la desviación estándar es pequeña (<3 chars), es columna fija
    const isFixed = stdDev < 3 && pricePositions.length >= 3;

    const bestSep = (Object.entries(separators) as [string, number][])
      .sort((a, b) => b[1] - a[1])[0];

    return {
      avgPositionPct: avgWidth > 0 ? Math.round((avgPos / avgWidth) * 100) : 0,
      isFixedColumn: isFixed,
      minCharPos: Math.round(Math.min(...pricePositions)),
      separator: bestSep[0],
    };
  }

  // ═════════════════════════════════════════════════════════════════
  // ITEMS MULTI-LÍNEA — nombre en una línea, precio en otra
  // ═════════════════════════════════════════════════════════════════

  private detectMultiLineItems(
    lines: string[],
    classification: StructuralFingerprint['lineClassification'],
  ): boolean {
    let multiLineCount = 0;

    for (let i = 0; i < classification.length - 1; i++) {
      const current = classification[i];
      const next = classification[i + 1];

      // Patrón: línea unknown/item sin precio + siguiente con precio solo
      if (
        (current.type === 'unknown' || current.type === 'item') &&
        !this.hasPrice(lines[current.index]) &&
        next.type !== 'total' &&
        /^\s*\$?\s*\d+(?:,\d{3})*\.\d{2}\s*[TECAM]?\s*$/.test(lines[next.index])
      ) {
        multiLineCount++;
      }
    }

    return multiLineCount >= 2; // Al menos 2 patrones multi-línea
  }

  private hasPrice(line: string): boolean {
    return /\d+(?:,\d{3})*\.\d{2}/.test(line);
  }

  // ═════════════════════════════════════════════════════════════════
  // SEPARADORES — qué caracteres separan nombre de precio
  // ═════════════════════════════════════════════════════════════════

  private detectSeparatorChars(lines: string[]): string[] {
    const seps = new Set<string>();

    for (const line of lines) {
      if (/\.{3,}/.test(line)) seps.add('dots');
      if (/-{3,}/.test(line) && !/^[-]+$/.test(line)) seps.add('dashes');
      if (/\t/.test(line)) seps.add('tabs');
      if (/\s{3,}/.test(line)) seps.add('wide-spaces');
    }

    return [...seps];
  }

  // ═════════════════════════════════════════════════════════════════
  // TOTAL PATTERNS
  // ═════════════════════════════════════════════════════════════════

  private detectTotalPatterns(lines: string[]) {
    const results: StructuralFingerprint['totalPatterns'] = [];
    const n = lines.length;

    for (let i = 0; i < n; i++) {
      const line = lines[i];
      for (const def of TOTAL_FIELD_PATTERNS) {
        if (def.patterns.some(p => p.test(line))) {
          const labels = [line.replace(/\$?\d+[\d,]*\.?\d*/g, '').trim()];
          results.push({
            field: def.field,
            labels: labels.filter(l => l.length > 0),
            positionFromBottom: Math.round(((n - i) / n) * 100),
          });
          break;
        }
      }
    }

    return results;
  }

  // ═════════════════════════════════════════════════════════════════
  // DATE FORMATS
  // ═════════════════════════════════════════════════════════════════

  private detectDateFormats(lines: string[]) {
    const found: string[] = [];
    const text = lines.join(' ');
    for (const def of DATE_FORMAT_DEFS) {
      if (def.pattern.test(text)) found.push(def.name);
    }
    return found;
  }

  // ═════════════════════════════════════════════════════════════════
  // KEYWORDS
  // ═════════════════════════════════════════════════════════════════

  private extractHeaderKeywords(lines: string[]): string[] {
    return this.extractZoneKeywords(lines.slice(0, Math.min(10, lines.length)));
  }

  private extractFooterKeywords(lines: string[]): string[] {
    return this.extractZoneKeywords(lines.slice(Math.max(0, lines.length - 12)));
  }

  private extractZonePatterns(zoneLines: string[]): string[] {
    const patterns: string[] = [];
    for (const line of zoneLines) {
      if (/^[-=*\.★─·]{3,}$/.test(line)) patterns.push('separator');
      if (/r\.?f\.?c\.?\s/i.test(line)) patterns.push('rfc');
      if (/^(av\.?|calle|blvd\.?|col\.?|c\.p\.?)\s/i.test(line)) patterns.push('address');
      if (/sucursal/i.test(line)) patterns.push('sucursal');
      if (/\d{2}:\d{2}:\d{2}/.test(line)) patterns.push('time');
      if (/folio/i.test(line)) patterns.push('folio');
      if (/caja|cajero/i.test(line)) patterns.push('cashier');
    }
    return [...new Set(patterns)];
  }

  private extractZoneKeywords(zoneLines: string[]): string[] {
    const words: string[] = [];
    for (const line of zoneLines) {
      const tokens = line.split(/\s+/).filter(t =>
        t.length > 3 && !/^\d+$/.test(t) && !/^[-=*\.★─·]+$/.test(t),
      );
      for (const t of tokens) {
        words.push(t.toLowerCase().replace(/[^a-záéíóúñü]/gi, ''));
      }
    }
    const freq: Record<string, number> = {};
    for (const w of words) {
      if (w.length < 3) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([word]) => word);
  }

  // ═════════════════════════════════════════════════════════════════
  // EXCLUDE PATTERNS
  // ═════════════════════════════════════════════════════════════════

  private detectExcludePatterns(lines: string[]): string[] {
    const excludes: string[] = [];
    for (const line of lines) {
      if (/^[-=*\.★─·]{5,}$/.test(line)) excludes.push(line.substring(0, 20));
      if (/gracias\s+por/i.test(line)) excludes.push(line.substring(0, 60));
      if (/aviso\s+de\s+privacidad/i.test(line)) excludes.push(line.substring(0, 60));
      if (/venta\s+en\s+l[ií]nea/i.test(line)) excludes.push(line.substring(0, 60));
    }
    return [...new Set(excludes)];
  }

  // ═════════════════════════════════════════════════════════════════
  // SECTIONS
  // ═════════════════════════════════════════════════════════════════

  private detectSections(lines: string[]) {
    const found: Array<{ pattern: string; categoria: string }> = [];
    for (const line of lines) {
      for (const def of SECTION_DEFS) {
        if (def.pattern.test(line) && line.length < 35) {
          found.push({ pattern: line.trim(), categoria: def.categoria });
          break;
        }
      }
    }
    return found;
  }

  // ═════════════════════════════════════════════════════════════════
  // TAX SUFFIXES
  // ═════════════════════════════════════════════════════════════════

  private detectTaxSuffixes(lines: string[]): string[] {
    const suffixes = new Set<string>();
    for (const line of lines) {
      const match = line.match(/\d+\.\d{2}\s*([TECAM])\s*$/);
      if (match) suffixes.add(match[1]);
    }
    return [...suffixes];
  }

  // ═════════════════════════════════════════════════════════════════
  // EMPTY
  // ═════════════════════════════════════════════════════════════════

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
      priceColumn: null,
      itemLineCount: 0,
      estimatedItemCount: 0,
      lineClassification: [],
      hasMultiLineItems: false,
      separatorChars: [],
    };
  }
}
