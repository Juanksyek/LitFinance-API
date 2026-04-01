import { Injectable, Logger } from '@nestjs/common';
import * as sharp from 'sharp';

export interface PreprocessedImage {
  /** Imagen procesada en base64 (JPEG) */
  processedBase64: string;
  /** MIME type de salida */
  mimeType: string;
  /** Tiles del body (para tickets largos) */
  tiles: string[];
  /** Metadata de la imagen original */
  originalMeta: {
    width: number;
    height: number;
    format: string;
  };
  /** Metadata de la imagen procesada */
  processedMeta: {
    width: number;
    height: number;
  };
}

/**
 * Preprocesamiento de imagen de ticket usando sharp:
 *   - Recorte fino (trim whitespace)
 *   - Corrección de rotación (EXIF autorotate)
 *   - Binarización / alto contraste
 *   - Escala a resolución óptima para OCR
 *   - Tiling para tickets largos
 */
@Injectable()
export class ImagePreprocessor {
  private readonly logger = new Logger(ImagePreprocessor.name);

  /** Ancho máximo para OCR (más allá de esto no mejora precisión) */
  private readonly MAX_WIDTH = 2400;
  /** Aspect ratio máximo antes de considerar "ticket largo" y hacer tiles */
  private readonly LONG_TICKET_RATIO = 4;
  /** Altura máxima por tile */
  private readonly TILE_HEIGHT = 2000;
  /** Overlap entre tiles (px) para no perder líneas en el borde */
  private readonly TILE_OVERLAP = 150;

  /**
   * Pipeline completo de preprocesamiento.
   * Devuelve imagen optimizada para OCR + tiles si es un ticket largo.
   */
  async preprocess(base64Image: string, mimeType = 'image/jpeg'): Promise<PreprocessedImage> {
    const inputBuffer = Buffer.from(base64Image, 'base64');
    const metadata = await sharp(inputBuffer).metadata();

    const originalMeta = {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      format: metadata.format ?? 'unknown',
    };

    this.logger.log(
      `[PREPROCESS] Original: ${originalMeta.width}×${originalMeta.height} ${originalMeta.format}`,
    );

    // Pipeline: autorotate → resize → grayscale → sharpen → normalize
    let pipeline = sharp(inputBuffer)
      .rotate() // Auto-rotate basado en EXIF
      .removeAlpha(); // Quitar canal alpha si existe

    // Resize si es demasiado ancho
    if (originalMeta.width > this.MAX_WIDTH) {
      pipeline = pipeline.resize(this.MAX_WIDTH, undefined, {
        withoutEnlargement: true,
        fit: 'inside',
      });
    }

    // Convertir a grayscale + normalizar contraste + afilar
    pipeline = pipeline
      .grayscale()
      .normalize() // Estira histograma para mejorar contraste
      .sharpen({ sigma: 1.5 }); // Afilar texto

    // Binarización suave: threshold adaptativo
    // Usar linear para ajustar niveles en vez de threshold duro
    pipeline = pipeline.linear(1.3, -(128 * 0.3)); // Aumentar contraste un 30%

    // Trim whitespace alrededor
    pipeline = pipeline.trim({ threshold: 20 });

    const processedBuffer = await pipeline.jpeg({ quality: 92 }).toBuffer();
    const processedMeta = await sharp(processedBuffer).metadata();

    const processedBase64 = processedBuffer.toString('base64');
    const processedWidth = processedMeta.width ?? originalMeta.width;
    const processedHeight = processedMeta.height ?? originalMeta.height;

    this.logger.log(
      `[PREPROCESS] Procesada: ${processedWidth}×${processedHeight} (${Math.round(processedBuffer.length / 1024)}KB)`,
    );

    // Generar tiles si el ticket es largo
    const aspectRatio = processedHeight / processedWidth;
    let tiles: string[] = [];

    if (aspectRatio > this.LONG_TICKET_RATIO && processedHeight > this.TILE_HEIGHT) {
      tiles = await this.generateTiles(processedBuffer, processedWidth, processedHeight);
      this.logger.log(`[PREPROCESS] Ticket largo — ${tiles.length} tiles generados`);
    }

    return {
      processedBase64,
      mimeType: 'image/jpeg',
      tiles,
      originalMeta,
      processedMeta: {
        width: processedWidth,
        height: processedHeight,
      },
    };
  }

  /**
   * Genera tiles con overlap para tickets largos.
   * Cada tile cubre TILE_HEIGHT px con TILE_OVERLAP px de overlap.
   */
  private async generateTiles(
    imageBuffer: Buffer,
    width: number,
    height: number,
  ): Promise<string[]> {
    const tiles: string[] = [];
    let y = 0;

    while (y < height) {
      const tileHeight = Math.min(this.TILE_HEIGHT, height - y);

      const tileBuffer = await sharp(imageBuffer)
        .extract({ left: 0, top: y, width, height: tileHeight })
        .jpeg({ quality: 90 })
        .toBuffer();

      tiles.push(tileBuffer.toString('base64'));
      y += this.TILE_HEIGHT - this.TILE_OVERLAP;
    }

    return tiles;
  }
}
