import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  IOcrProvider,
  OcrProviderResult,
  OcrLine,
} from '../ocr-provider.interface';

/**
 * Proveedor OCR que delega al microservicio Python (FastAPI).
 *
 * El worker Python ejecuta OpenCV + PaddleOCR + Tesseract y devuelve
 * candidatos rankeados. Este proveedor traduce la respuesta al formato
 * `OcrProviderResult` para que el orquestador lo mezcle con otros proveedores.
 *
 * Requiere env var: OCR_WORKER_URL (default: http://localhost:8100)
 */
@Injectable()
export class PythonOcrWorkerProvider implements IOcrProvider {
  private readonly logger = new Logger(PythonOcrWorkerProvider.name);

  readonly name = 'python-worker';
  readonly priority = 1; // Primario — PaddleOCR + Tesseract con OpenCV

  private get workerUrl(): string {
    return process.env.OCR_WORKER_URL || 'http://localhost:8100';
  }

  isEnabled(): boolean {
    // Habilitado si la URL está configurada (o si hay un worker local corriendo)
    return !!process.env.OCR_WORKER_URL;
  }

  async extract(base64Image: string, mimeType: string, clientOcrText?: string): Promise<OcrProviderResult[]> {
    try {
      const url = `${this.workerUrl}/ocr`;

      this.logger.log(`[PYTHON-WORKER] Enviando imagen al worker: ${url}`);

      const response = await axios.post(
        url,
        {
          image_base64: base64Image,
          mime_type: mimeType,
          local_ocr: clientOcrText || undefined,
          local_ocr_score: clientOcrText ? 0.7 : undefined,
        },
        {
          timeout: 60_000,
        } as any,
      );

      const data = response.data as {
        candidates?: Array<{
          source: string;
          variant: string;
          raw_text: string;
          lines: string[];
          score: number;
        }>;
        best_source?: string;
        confidence?: number;
      };

      if (!data.candidates || data.candidates.length === 0) {
        this.logger.warn('[PYTHON-WORKER] Sin candidatos');
        return [];
      }

      this.logger.log(
        `[PYTHON-WORKER] ${data.candidates.length} candidatos, ` +
        `mejor: ${data.best_source} (conf=${data.confidence})`,
      );

      // Convertir cada candidato del worker a OcrProviderResult
      const results: OcrProviderResult[] = data.candidates.map((candidate: any) => {
        const lines: OcrLine[] = (candidate.lines || []).map((text: string) => ({
          text,
          words: text.split(/\s+/).map((w: string) => ({
            text: w,
            confidence: candidate.score || 0.5,
          })),
        }));

        return {
          provider: `python-${candidate.source}`,
          variant: candidate.variant,
          plainText: candidate.raw_text,
          lines,
          structuredFields: [],
          structuredItems: [],
          overallConfidence: candidate.score || 0,
          rawJson: JSON.stringify(candidate),
        } as OcrProviderResult;
      });

      return results;

    } catch (err: any) {
      if (err.code === 'ECONNREFUSED') {
        this.logger.warn('[PYTHON-WORKER] Worker no disponible (ECONNREFUSED)');
      } else {
        this.logger.error(
          `[PYTHON-WORKER] Error: ${err.message}`,
        );
      }
      return [];
    }
  }
}
