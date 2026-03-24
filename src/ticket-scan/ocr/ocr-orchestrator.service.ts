import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as FormData from 'form-data';
import { OcrVariant } from './ocr.types';

/**
 * Orquestador OCR: ejecuta múltiples variantes de OCR.space en paralelo
 * y devuelve todos los textos candidatos deduplicados.
 */
@Injectable()
export class OcrOrchestrator {
  private readonly logger = new Logger(OcrOrchestrator.name);

  private readonly variants: OcrVariant[] = [
    { engine: 2, isTable: false, label: 'E2-noTable' },
    { engine: 2, isTable: true,  label: 'E2-table' },
    { engine: 1, isTable: false, label: 'E1-noTable' },
  ];

  /**
   * Ejecuta múltiples variantes OCR y devuelve textos candidatos únicos.
   * Si se proporciona texto del cliente (ML Kit / Apple Vision), se incluye como primer candidato.
   */
  async extractAll(
    base64Image: string,
    mimeType = 'image/jpeg',
    clientOcrText?: string,
  ): Promise<string[]> {
    const candidates: string[] = [];

    // Texto del cliente siempre como primer candidato
    if (clientOcrText && clientOcrText.trim().length > 10) {
      candidates.push(clientOcrText.trim());
    }

    const apiKey = process.env.OCR_SPACE_API_KEY;
    if (!apiKey) {
      this.logger.warn('OCR_SPACE_API_KEY no configurada — solo usando texto del cliente');
      return candidates;
    }

    // Ejecutar variantes en paralelo
    const results = await Promise.allSettled(
      this.variants.map((v) => this.callOcrSpace(base64Image, mimeType, apiKey, v)),
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const label = this.variants[i].label;
      if (r.status === 'fulfilled' && r.value.trim().length > 10) {
        this.logger.log(`[OCR] ${label}: ${r.value.length} chars`);
        candidates.push(r.value.trim());
      } else if (r.status === 'rejected') {
        this.logger.warn(`[OCR] ${label} falló: ${r.reason?.message ?? r.reason}`);
      }
    }

    return this.deduplicateCandidates(candidates);
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

  /**
   * Elimina textos duplicados o demasiado similares entre candidatos.
   * Usa normalización para comparar igualdad semántica.
   */
  private deduplicateCandidates(texts: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const text of texts) {
      const normalized = text
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9 ]/g, '')
        .trim();

      if (normalized.length < 10) continue;
      // Usar primeros 200 chars como huella digital
      const fingerprint = normalized.substring(0, 200);
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        result.push(text);
      }
    }

    return result;
  }
}
