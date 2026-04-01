import { FieldConfidence, TicketKind } from './ocr.types';

// ─── Tipos del sistema multi-proveedor OCR ─────────────────────────────────

/** Palabra individual con posición (para layout-aware parsing) */
export interface OcrWord {
  text: string;
  confidence: number;
  /** Bounding box [x, y, width, height] normalizado 0-1 */
  boundingBox?: [number, number, number, number];
}

/** Línea de texto con posición */
export interface OcrLine {
  text: string;
  words: OcrWord[];
  /** Coordenada Y normalizada (0-1) — para detectar columnas y posición vertical */
  yPosition?: number;
}

/** Campo estructurado extraído por un proveedor inteligente (Azure/Google) */
export interface StructuredField {
  name: string;
  value: string;
  confidence: number;
}

/** Item estructurado extraído por un proveedor inteligente */
export interface StructuredLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  confidence: number;
}

/** Resultado raw de un proveedor OCR */
export interface OcrProviderResult {
  /** Nombre del proveedor */
  provider: string;
  /** Label de la variante (ej: "E2-noTable", "azure-receipt", "azure-read") */
  variant: string;
  /** Texto plano extraído */
  plainText: string;
  /** Líneas con layout (si el proveedor lo soporta) */
  lines: OcrLine[];
  /** Campos estructurados (solo proveedores inteligentes como Azure Receipt) */
  structuredFields: StructuredField[];
  /** Items estructurados (solo proveedores inteligentes) */
  structuredItems: StructuredLineItem[];
  /** Confianza global del proveedor (0-1) */
  overallConfidence: number;
  /** JSON crudo de la respuesta del proveedor (para dataset/training) */
  rawJson: string;
  /** Si el proveedor falló */
  error?: string;
}

/** Interfaz que debe implementar cada proveedor OCR */
export interface IOcrProvider {
  /** Nombre del proveedor */
  readonly name: string;
  /** Prioridad (menor = mayor prioridad): 1=primario, 2=secundario, 3=fallback */
  readonly priority: number;
  /** Si el proveedor está habilitado (tiene API key configurada) */
  isEnabled(): boolean;
  /** Extrae texto + estructura de una imagen en base64 */
  extract(base64Image: string, mimeType: string): Promise<OcrProviderResult[]>;
}

/** Token de inyección para la lista de proveedores OCR */
export const OCR_PROVIDERS = 'OCR_PROVIDERS';
