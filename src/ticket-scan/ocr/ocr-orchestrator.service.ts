import { Injectable, Logger } from '@nestjs/common';
import { IOcrProvider, OcrProviderResult } from './ocr-provider.interface';
import { ImagePreprocessor } from './image-preprocessor.service';
import { AzureOcrProvider } from './providers/azure.provider';
import { OcrSpaceProvider } from './providers/ocrspace.provider';
import { PythonOcrWorkerProvider } from './providers/python-worker.provider';

/**
 * Orquestador OCR multi-proveedor:
 *   1. Preprocesa la imagen (sharp: autorotate, grayscale, contrast, trim, tiles)
 *   2. Ejecuta proveedores en orden de prioridad (Azure > OCR.space)
 *   3. Incluye texto del cliente (ML Kit / Apple Vision) como candidato
 *   4. Devuelve todos los resultados deduplicados + texto del cliente
 *
 * Si la imagen es larga, también pasa los tiles a los proveedores.
 */
@Injectable()
export class OcrOrchestrator {
  private readonly logger = new Logger(OcrOrchestrator.name);
  private readonly providers: IOcrProvider[];

  constructor(
    private readonly imagePreprocessor: ImagePreprocessor,
    private readonly azureProvider: AzureOcrProvider,
    private readonly ocrSpaceProvider: OcrSpaceProvider,
    private readonly pythonWorkerProvider: PythonOcrWorkerProvider,
  ) {
    // Ordenar proveedores por prioridad (menor = mayor prioridad)
    this.providers = [this.pythonWorkerProvider, this.azureProvider, this.ocrSpaceProvider]
      .filter(p => p.isEnabled())
      .sort((a, b) => a.priority - b.priority);

    this.logger.log(
      `[ORCHESTRATOR] Proveedores activos: [${this.providers.map(p => `${p.name}(p${p.priority})`).join(', ')}]`,
    );
  }

  /**
   * Pipeline completo:
   *   imagen → preprocesar → OCR multi-proveedor → deduplicar → devolver resultados + textos
   *
   * @returns texts - textos candidatos deduplicados (para parseo por regex/extractores)
   * @returns providerResults - resultados crudos de cada proveedor (para merge inteligente)
   */
  async extractAll(
    base64Image: string,
    mimeType = 'image/jpeg',
    clientOcrText?: string,
  ): Promise<{
    texts: string[];
    providerResults: OcrProviderResult[];
  }> {
    const allResults: OcrProviderResult[] = [];
    const texts: string[] = [];

    // 0. Texto del cliente siempre como primer candidato
    if (clientOcrText && clientOcrText.trim().length > 10) {
      texts.push(clientOcrText.trim());
      allResults.push({
        provider: 'client',
        variant: 'mlkit-vision',
        plainText: clientOcrText.trim(),
        lines: clientOcrText.trim().split('\n').map(text => ({
          text,
          words: text.split(/\s+/).map(w => ({ text: w, confidence: 0.75 })),
        })),
        structuredFields: [],
        structuredItems: [],
        overallConfidence: 0.7,
        rawJson: JSON.stringify({ source: 'client', text: clientOcrText }),
      });
    }

    // 1. Preprocesar imagen
    let processedBase64 = base64Image;
    let processedMimeType = mimeType;
    let tiles: string[] = [];

    try {
      const preprocessed = await this.imagePreprocessor.preprocess(base64Image, mimeType);
      processedBase64 = preprocessed.processedBase64;
      processedMimeType = preprocessed.mimeType;
      tiles = preprocessed.tiles;
      this.logger.log(
        `[ORCHESTRATOR] Preprocesada: ${preprocessed.processedMeta.width}×${preprocessed.processedMeta.height} | tiles=${tiles.length}`,
      );
    } catch (err) {
      this.logger.warn(`[ORCHESTRATOR] Preprocesamiento falló, usando imagen original: ${err}`);
    }

    // 2. Ejecutar proveedores habilitados en paralelo
    if (this.providers.length === 0) {
      this.logger.warn('[ORCHESTRATOR] No hay proveedores OCR configurados');
      return { texts, providerResults: allResults };
    }

    const providerPromises = this.providers.map(async (provider) => {
      try {
        const results = await provider.extract(processedBase64, processedMimeType);

        // Si hay tiles, también pasarlos al proveedor y concatenar
        if (tiles.length > 0 && provider.priority <= 2) {
          const tileResults = await Promise.allSettled(
            tiles.map(tile => provider.extract(tile, processedMimeType)),
          );
          for (const tr of tileResults) {
            if (tr.status === 'fulfilled') {
              results.push(...tr.value);
            }
          }
        }

        return results;
      } catch (err) {
        this.logger.warn(`[ORCHESTRATOR] ${provider.name} falló: ${err}`);
        return [];
      }
    });

    const providerResultArrays = await Promise.allSettled(providerPromises);

    for (const pr of providerResultArrays) {
      if (pr.status === 'fulfilled') {
        allResults.push(...pr.value);
      }
    }

    // 3. Extraer textos planos y deduplicar
    for (const result of allResults) {
      if (result.plainText.trim().length > 10 && result.provider !== 'client') {
        texts.push(result.plainText.trim());
      }
    }

    const dedupedTexts = this.deduplicateCandidates(texts);

    this.logger.log(
      `[ORCHESTRATOR] ${allResults.length} resultados de ${new Set(allResults.map(r => r.provider)).size} proveedores → ${dedupedTexts.length} textos únicos`,
    );

    return { texts: dedupedTexts, providerResults: allResults };
  }

  /**
   * Elimina textos duplicados o demasiado similares entre candidatos.
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
      const fingerprint = normalized.substring(0, 200);
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        result.push(text);
      }
    }

    return result;
  }
}
