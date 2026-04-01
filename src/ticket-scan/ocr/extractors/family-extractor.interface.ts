import { ParsedItem } from '../ocr.types';

/**
 * Interfaz que deben implementar los extractores especializados por familia de ticket.
 * Cada familia tiene sus propios patrones de parsing.
 */
export interface ITicketFamilyExtractor {
  /** Nombre identificador de la familia */
  readonly familyName: string;
  /** Tipos de ticket que esta familia soporta */
  readonly supportedKinds: string[];
  /** Extrae items del texto del ticket */
  extractItems(lines: string[], defaultCategory?: string): ParsedItem[];
}
