import { Injectable, Logger } from '@nestjs/common';
import {
  DocumentAnalysisClient,
  AzureKeyCredential,
  AnalyzeResult,
} from '@azure/ai-form-recognizer';
import {
  IOcrProvider,
  OcrProviderResult,
  OcrLine,
  OcrWord,
  StructuredField,
  StructuredLineItem,
} from '../ocr-provider.interface';

/**
 * Proveedor OCR principal: Azure Document Intelligence.
 *
 * Usa dos modelos:
 *   1. prebuilt-receipt — extrae campos estructurados (merchant, date, tax, total, items)
 *   2. prebuilt-read    — extrae texto con layout (palabras, líneas, posiciones)
 *
 * Requiere env vars:
 *   AZURE_FORM_RECOGNIZER_ENDPOINT - URL del recurso Azure
 *   AZURE_FORM_RECOGNIZER_KEY      - API key
 */
@Injectable()
export class AzureOcrProvider implements IOcrProvider {
  private readonly logger = new Logger(AzureOcrProvider.name);

  readonly name = 'azure';
  readonly priority = 1; // Primario

  private client: DocumentAnalysisClient | null = null;

  private getClient(): DocumentAnalysisClient | null {
    if (this.client) return this.client;

    const endpoint = process.env.AZURE_FORM_RECOGNIZER_ENDPOINT;
    const key = process.env.AZURE_FORM_RECOGNIZER_KEY;

    if (!endpoint || !key) return null;

    this.client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
    return this.client;
  }

  isEnabled(): boolean {
    return !!(
      process.env.AZURE_FORM_RECOGNIZER_ENDPOINT &&
      process.env.AZURE_FORM_RECOGNIZER_KEY
    );
  }

  async extract(base64Image: string, mimeType: string): Promise<OcrProviderResult[]> {
    const client = this.getClient();
    if (!client) {
      this.logger.warn('[AZURE] No configurado — omitiendo');
      return [];
    }

    const imageBuffer = Buffer.from(base64Image, 'base64');
    const results: OcrProviderResult[] = [];

    // Ejecutar ambos modelos en paralelo
    const [receiptResult, readResult] = await Promise.allSettled([
      this.analyzeReceipt(client, imageBuffer),
      this.analyzeRead(client, imageBuffer),
    ]);

    if (receiptResult.status === 'fulfilled' && receiptResult.value) {
      results.push(receiptResult.value);
      this.logger.log(`[AZURE] Receipt: ${receiptResult.value.structuredFields.length} campos, ${receiptResult.value.structuredItems.length} items`);
    } else if (receiptResult.status === 'rejected') {
      this.logger.warn(`[AZURE] Receipt falló: ${receiptResult.reason?.message}`);
    }

    if (readResult.status === 'fulfilled' && readResult.value) {
      results.push(readResult.value);
      this.logger.log(`[AZURE] Read: ${readResult.value.lines.length} líneas, ${readResult.value.plainText.length} chars`);
    } else if (readResult.status === 'rejected') {
      this.logger.warn(`[AZURE] Read falló: ${readResult.reason?.message}`);
    }

    return results;
  }

  /**
   * Modelo prebuilt-receipt: extrae campos estructurados de recibos.
   * Devuelve merchant, date, total, tax, line items, etc.
   */
  private async analyzeReceipt(
    client: DocumentAnalysisClient,
    imageBuffer: Buffer,
  ): Promise<OcrProviderResult | null> {
    const poller = await client.beginAnalyzeDocument('prebuilt-receipt', imageBuffer);
    const result: AnalyzeResult = await poller.pollUntilDone();

    if (!result.documents || result.documents.length === 0) {
      return null;
    }

    const doc = result.documents[0];
    const fields: StructuredField[] = [];
    const items: StructuredLineItem[] = [];

    // Extraer campos estructurados
    const fieldMap = doc.fields ?? {};

    // Helper: extraer valor de un DocumentField como string
    const getFieldValue = (field: any): string => {
      if (!field) return '';
      // content es siempre un string con el texto extraído
      if (field.content) return field.content;
      // value puede ser string, number, Date dependiendo del kind
      if (field.value !== undefined) {
        if (field.value instanceof Date) return field.value.toISOString();
        return String(field.value);
      }
      return '';
    };

    if (fieldMap['MerchantName']) {
      fields.push({
        name: 'merchantName',
        value: getFieldValue(fieldMap['MerchantName']),
        confidence: fieldMap['MerchantName'].confidence ?? 0,
      });
    }

    if (fieldMap['MerchantAddress']) {
      fields.push({
        name: 'merchantAddress',
        value: getFieldValue(fieldMap['MerchantAddress']),
        confidence: fieldMap['MerchantAddress'].confidence ?? 0,
      });
    }

    if (fieldMap['TransactionDate']) {
      fields.push({
        name: 'transactionDate',
        value: getFieldValue(fieldMap['TransactionDate']),
        confidence: fieldMap['TransactionDate'].confidence ?? 0,
      });
    }

    if (fieldMap['Subtotal']) {
      fields.push({
        name: 'subtotal',
        value: getFieldValue(fieldMap['Subtotal']),
        confidence: fieldMap['Subtotal'].confidence ?? 0,
      });
    }

    if (fieldMap['Tax']) {
      fields.push({
        name: 'tax',
        value: getFieldValue(fieldMap['Tax']),
        confidence: fieldMap['Tax'].confidence ?? 0,
      });
    }

    if (fieldMap['Total']) {
      fields.push({
        name: 'total',
        value: getFieldValue(fieldMap['Total']),
        confidence: fieldMap['Total'].confidence ?? 0,
      });
    }

    if (fieldMap['Tip']) {
      fields.push({
        name: 'tip',
        value: getFieldValue(fieldMap['Tip']),
        confidence: fieldMap['Tip'].confidence ?? 0,
      });
    }

    // Extraer line items
    const itemsField = fieldMap['Items'] as any;
    if (itemsField?.values && Array.isArray(itemsField.values)) {
      for (const item of itemsField.values) {
        const itemFields = item.properties ?? item.value ?? {};
        items.push({
          description: getFieldValue(itemFields['Description']),
          quantity: Number(getFieldValue(itemFields['Quantity']) || 1),
          unitPrice: Number(getFieldValue(itemFields['Price']) || 0),
          totalPrice: Number(getFieldValue(itemFields['TotalPrice']) || 0),
          confidence: itemFields['Description']?.confidence ?? 0,
        });
      }
    }

    // Extraer texto plano del resultado
    const plainText = (result.pages ?? [])
      .flatMap(p => (p.lines ?? []).map(l => l.content))
      .join('\n');

    return {
      provider: 'azure',
      variant: 'receipt',
      plainText,
      lines: this.extractLines(result),
      structuredFields: fields,
      structuredItems: items,
      overallConfidence: doc.confidence ?? 0,
      rawJson: JSON.stringify(result),
    };
  }

  /**
   * Modelo prebuilt-read: extrae texto con layout completo.
   * Devuelve palabras, líneas y posiciones para parsing por layout.
   */
  private async analyzeRead(
    client: DocumentAnalysisClient,
    imageBuffer: Buffer,
  ): Promise<OcrProviderResult | null> {
    const poller = await client.beginAnalyzeDocument('prebuilt-read', imageBuffer);
    const result: AnalyzeResult = await poller.pollUntilDone();

    if (!result.pages || result.pages.length === 0) {
      return null;
    }

    const plainText = result.pages
      .flatMap(p => (p.lines ?? []).map(l => l.content))
      .join('\n');

    return {
      provider: 'azure',
      variant: 'read',
      plainText,
      lines: this.extractLines(result),
      structuredFields: [],
      structuredItems: [],
      overallConfidence: 0.8,
      rawJson: JSON.stringify(result),
    };
  }

  /**
   * Convierte las líneas de Azure a nuestro formato OcrLine con posiciones.
   * Azure polygon usa Point2D[] con { x, y }.
   */
  private extractLines(result: AnalyzeResult): OcrLine[] {
    const lines: OcrLine[] = [];

    for (const page of result.pages ?? []) {
      const pageHeight = page.height ?? 1;

      for (const line of page.lines ?? []) {
        const linePolygon = line.polygon ?? [];
        const lineY = linePolygon.length > 0 ? (linePolygon[0] as any).y ?? linePolygon[1] ?? 0 : 0;
        const lineYNum = typeof lineY === 'number' ? lineY : 0;

        const words: OcrWord[] = (page.words ?? [])
          .filter(w => {
            if (!w.polygon || !line.polygon) return false;
            const wordPoly = w.polygon as any[];
            const wordY = wordPoly.length > 0
              ? (typeof wordPoly[0] === 'object' ? wordPoly[0].y : wordPoly[1]) ?? 0
              : 0;
            return Math.abs(wordY - lineYNum) < (pageHeight * 0.02);
          })
          .map(w => {
            const poly = w.polygon as any[];
            let boundingBox: [number, number, number, number] | undefined;

            if (poly && poly.length >= 4) {
              if (typeof poly[0] === 'object') {
                // Point2D format: { x, y }
                boundingBox = [
                  poly[0].x ?? 0,
                  poly[0].y ?? 0,
                  (poly[1].x ?? 0) - (poly[0].x ?? 0),
                  (poly[2].y ?? 0) - (poly[0].y ?? 0),
                ];
              } else {
                // Flat [x1,y1,x2,y2,...] format
                boundingBox = [
                  poly[0] ?? 0,
                  poly[1] ?? 0,
                  (poly[2] ?? 0) - (poly[0] ?? 0),
                  (poly[5] ?? 0) - (poly[1] ?? 0),
                ];
              }
            }

            return {
              text: w.content,
              confidence: w.confidence ?? 0,
              boundingBox,
            };
          });

        lines.push({
          text: line.content,
          words,
          yPosition: lineYNum / pageHeight,
        });
      }
    }

    return lines;
  }
}
