import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentExtractor {
  /**
   * Detecta el método de pago del texto completo del ticket.
   */
  extract(fullText: string): string {
    const lower = fullText.toLowerCase();
    if (lower.includes('efectivo') || lower.includes('cash')) return 'efectivo';
    if (
      lower.includes('tarjeta') ||
      lower.includes('visa') ||
      lower.includes('mastercard') ||
      lower.includes('card')
    ) return 'tarjeta';
    if (lower.includes('transferencia') || lower.includes('spei')) return 'transferencia';
    return '';
  }
}
