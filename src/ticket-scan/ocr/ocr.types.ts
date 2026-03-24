// ─── Tipos base del pipeline OCR ───────────────────────────────────────────────

export type TicketKind =
  | 'supermercado'
  | 'restaurante'
  | 'farmacia'
  | 'gasolinera'
  | 'departamental'
  | 'conveniencia'
  | 'servicios'
  | 'desconocido';

/** Confianza por campo individual */
export interface FieldConfidence {
  tienda: number;
  fechaCompra: number;
  items: number;
  subtotal: number;
  impuestos: number;
  total: number;
  metodoPago: number;
}

/** Resultado parseado de un candidato OCR completo */
export interface TicketParseResult {
  rawText: string;
  tienda: string;
  direccionTienda: string;
  fechaCompra: string;
  items: ParsedItem[];
  subtotal: number;
  impuestos: number;
  iva: number;
  ieps: number;
  descuentos: number;
  propina: number;
  total: number;
  metodoPago: string;
  tipoTicket: TicketKind;
  score: number;
  confidence: FieldConfidence;
  warnings: string[];
}

/** Item parseado antes de categorización */
export interface ParsedItem {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  categoria: string;
  confianza: number;
  detalles: string[];
}

/** Variante de configuración para OCR.space */
export interface OcrVariant {
  engine: 1 | 2;
  isTable: boolean;
  label: string;
}

/** Información de tienda detectada */
export interface DetectedStore {
  name: string;
  defaultCategory: string;
}
