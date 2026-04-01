import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as FormData from 'form-data';
import {
  IOcrProvider,
  OcrProviderResult,
  OcrLine,
} from '../ocr-provider.interface';
import { OcrVariant } from '../ocr.types';

/**
 * Proveedor OCR fallback: OCR.space
 *
 * Ejecuta 3 variantes en paralelo:
 *   - Engine 2 sin tabla
 *   - Engine 2 con tabla
 *   - Engine 1 sin tabla
 *
 * Requiere env var: OCR_SPACE_API_KEY
 */
@Injectable()
export class OcrSpaceProvider implements IOcrProvider {
  private readonly logger = new Logger(OcrSpaceProvider.name);

  readonly name = 'ocrspace';
  readonly priority = 3; // Fallback

  private readonly variants: OcrVariant[] = [
    { engine: 2, isTable: false, label: 'E2-noTable' },
    { engine: 2, isTable: true,  label: 'E2-table' },
    { engine: 1, isTable: false, label: 'E1-noTable' },
  ];

  isEnabled(): boolean {
    return !!process.env.OCR_SPACE_API_KEY;
  }

  async extract(base64Image: string, mimeType: string): Promise<OcrProviderResult[]> {
    const apiKey = process.env.OCR_SPACE_API_KEY;
    if (!apiKey) {
      this.logger.warn('[OCRSPACE] API key no configurada — omitiendo');
      return [];
    }

    const results = await Promise.allSettled(
      this.variants.map((v) => this.callOcrSpace(base64Image, mimeType, apiKey, v)),
    );

    const providerResults: OcrProviderResult[] = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const label = this.variants[i].label;

      if (r.status === 'fulfilled' && r.value.trim().length > 10) {
        this.logger.log(`[OCRSPACE] ${label}: ${r.value.length} chars`);
        providerResults.push({
          provider: 'ocrspace',
          variant: label,
          plainText: r.value.trim(),
          lines: r.value.trim().split('\n').map(text => ({
            text,
            words: text.split(/\s+/).map(w => ({ text: w, confidence: 0.7 })),
          })),
          structuredFields: [],
          structuredItems: [],
          overallConfidence: 0.6,
          rawJson: JSON.stringify({ text: r.value, variant: label }),
        });
      } else if (r.status === 'rejected') {
        this.logger.warn(`[OCRSPACE] ${label} falló: ${r.reason?.message ?? r.reason}`);
      }
    }

    return providerResults;
  }

  private async callOcrSpace(
    base64Image: string,
    mimeType: string,
    apiKey: string,
    variant: OcrVariant,
  ): Promise<string> {
    const form = new FormData();
    form.append('base64Image', `data:${mimeType};base64,${base64Image}`);
    form.append('language', 'spa');
    form.append('OCREngine', String(variant.engine));
    form.append('scale', 'true');
    form.append('isTable', String(variant.isTable));

    const response = await axios.post<{
      ParsedResults?: Array<{ ParsedText: string }>;
      IsErroredOnProcessing?: boolean;
    }>(
      'https://api.ocr.space/parse/image',
      form,
      {
        headers: { ...form.getHeaders(), apikey: apiKey },
        timeout: 30_000,
      },
    );

    return response.data?.ParsedResults?.[0]?.ParsedText ?? '';
  }
}
