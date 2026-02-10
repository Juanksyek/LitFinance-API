import { Injectable, Logger } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import * as ExcelJS from 'exceljs';
import { AnalyticsService } from '../../analytics/analytics.service';
import { UserService } from '../../user/user.service';
import { ExportReportQueryDto, ReportExportFormat } from '../dto/report-export.dto';

function toIsoDateOnly(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function safeFilename(input: string): string {
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

type ExportResult = {
  filename: string;
  mimeType: string;
  base64: string;
  sizeBytes: number;
  generatedAt: string;
  meta: Record<string, any>;
};

@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);

  /** Tema premium (colores + tipografía base) */
  private readonly THEME = {
    brand: 'LitFinance',
    pdf: {
      font: {
        regular: 'Helvetica',
        bold: 'Helvetica-Bold',
      },
    },
    palette: {
      paper: '#FFFFFF',
      ink: '#0B0F1A',
      muted: '#6B7280',
      subtle: '#E5E7EB',
      bgSoft: '#F8FAFC',
      rowAlt: '#F3F4F6',
      navy: '#0B1220',
      gold: '#F5B301',
      blue: '#2563EB',
      red: '#E11D48',
      green: '#16A34A',
      purple: '#7C3AED',
      teal: '#14B8A6',
    },
    excel: {
      // ARGB colors for ExcelJS (FF + hex without #)
      headerFont: 'FF0B0F1A',
      headerFill: 'FFE5E7EB',
      border: 'FFE5E7EB',
    },
  } as const;

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly userService: UserService,
  ) {}

  async exportar(userId: string, q: ExportReportQueryDto): Promise<ExportResult> {
    const format: ReportExportFormat = q.format ?? 'pdf';
    const incluirMovimientos = q.incluirMovimientos ?? true;
    const limiteMovimientos = q.limiteMovimientos ?? (format === 'pdf' ? 800 : 5000);
    const topN = q.topN ?? 8;

    // Reutilizamos filtros de analytics
    const filtrosAnalytics: any = {
      rango: q.rango,
      fechaInicio: q.fechaInicio,
      fechaFin: q.fechaFin,
      monedaBase: q.monedaBase,
      topN,
    };

    const [perfil, resumenInteligente, comparacion, movimientosResp] = await Promise.all([
      this.userService.getProfile(userId),
      this.analyticsService.obtenerResumenInteligente(userId, filtrosAnalytics),
      this.analyticsService.compararPeriodos(userId, filtrosAnalytics),
      incluirMovimientos
        ? this.analyticsService.obtenerMovimientosDetallados(userId, {
            ...filtrosAnalytics,
            pagina: 1,
            limite: limiteMovimientos,
            ordenarPor: 'fecha',
            ordenDireccion: 'desc',
          } as any)
        : Promise.resolve(null as any),
    ]);

    const fechaInicio = resumenInteligente.periodo.fechaInicio as any as Date;
    const fechaFin = resumenInteligente.periodo.fechaFin as any as Date;

    const nombre = (perfil as any)?.nombreCompleto ?? (perfil as any)?.nombre ?? 'Usuario';
    const moneda = resumenInteligente.moneda ?? q.monedaBase ?? perfil?.monedaPrincipal ?? 'MXN';

    const model = {
      title: 'Reporte Financiero',
      generatedAt: new Date(),
      user: {
        id: userId,
        nombre,
        email: perfil?.email ?? null,
      },
      periodo: {
        fechaInicio,
        fechaFin,
        descripcion: resumenInteligente.periodo.descripcion,
      },
      moneda,
      resumen: resumenInteligente,
      comparacion,
      movimientos: movimientosResp?.movimientos ?? [],
      movimientosMeta: movimientosResp?.paginacion ?? null,
    };

    const baseName = safeFilename(
      `LitFinance_${model.title}_${toIsoDateOnly(new Date(model.periodo.fechaInicio))}_${toIsoDateOnly(
        new Date(model.periodo.fechaFin),
      )}`,
    );

    let buffer: Buffer;
    let mimeType: string;
    let filename: string;

    if (format === 'pdf') {
      buffer = await this.generarPdf(model);
      mimeType = 'application/pdf';
      filename = `${baseName}.pdf`;
    } else {
      buffer = await this.generarXlsx(model);
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      filename = `${baseName}.xlsx`;
    }

    return {
      filename,
      mimeType,
      base64: buffer.toString('base64'),
      sizeBytes: buffer.length,
      generatedAt: model.generatedAt.toISOString(),
      meta: {
        format,
        incluirMovimientos,
        limiteMovimientos,
        movimientosTotal: model.movimientosMeta?.totalElementos ?? model.movimientos.length,
        topN,
        moneda,
        periodo: {
          fechaInicio: new Date(model.periodo.fechaInicio).toISOString(),
          fechaFin: new Date(model.periodo.fechaFin).toISOString(),
          descripcion: model.periodo.descripcion,
        },
      },
    };
  }

  // ============================================================
  // PDF (premium)
  // ============================================================

  private async generarPdf(model: any): Promise<Buffer> {
    // bottom mayor para reservar footer y evitar choques
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 54, bottom: 62, left: 46, right: 46 },
      bufferPages: true,
      info: {
        Title: `${this.THEME.brand} | ${model.title}`,
        Author: this.THEME.brand,
        CreationDate: model.generatedAt,
        ModDate: model.generatedAt,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));

    const endPromise = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Portada (primera página existente) — IMPORTANTÍSIMO: nada aquí debe empujar página
    this.pdfCover(doc, model);

    // Contenido
    doc.addPage();
    this.pdfHeader(doc, model, { compact: false });

    // =========================
    // Resumen + donut
    // =========================
    this.startSection(doc, model, 'Resumen ejecutivo', 'KPIs + distribución de ingresos y egresos', 250);

    const tot = model.resumen?.totales ?? {};
    const ingresos = this.asNumber(tot.ingresos) ?? 0;
    const gastos = this.asNumber(tot.gastos) ?? 0;
    const balance = this.asNumber(tot.balance) ?? ingresos - gastos;
    const movs = this.asNumber(tot.movimientos) ?? 0;

    this.kpiCards(doc, [
      { label: 'Ingresos', value: this.fmtMoney(ingresos, model.moneda), tone: 'blue' },
      { label: 'Egresos', value: this.fmtMoney(gastos, model.moneda), tone: 'red' },
      { label: 'Balance neto', value: this.fmtMoney(balance, model.moneda), tone: balance >= 0 ? 'green' : 'red' },
      { label: 'Movimientos', value: this.fmtInt(movs), tone: 'neutral' },
    ]);

    // donut al lado derecho (posicionado absoluto, no “flow”)
    this.ensureSpace(doc, model, 140);
    const left = doc.page.margins.left ?? 46;
    const right = doc.page.width - (doc.page.margins.right ?? 46);
    const donutCx = right - 95;
    const donutCy = doc.y - 65; // lo levantamos para quedar al lado del KPI grid

    this.drawDonut(doc, donutCx, donutCy, 44, 12, [
      { label: 'Ingresos', value: ingresos, color: this.THEME.palette.blue },
      { label: 'Egresos', value: gastos, color: this.THEME.palette.red },
    ]);

    // mini-leyenda donut
    doc.save();
    doc.font(this.THEME.pdf.font.regular).fontSize(9).fillColor(this.THEME.palette.muted);
    doc.text('Ingresos', donutCx - 50, donutCy + 60, { width: 60, align: 'left', lineBreak: false });
    doc.fillColor(this.THEME.palette.blue).circle(donutCx - 62, donutCy + 64, 3).fill();
    doc.fillColor(this.THEME.palette.muted).text('Egresos', donutCx + 5, donutCy + 60, { width: 60, align: 'left', lineBreak: false });
    doc.fillColor(this.THEME.palette.red).circle(donutCx - 8, donutCy + 64, 3).fill();
    doc.restore();

    // resumen textual compacto
    this.richParagraph(
      doc,
      `Periodo **${this.iso(model.periodo.fechaInicio)}** a **${this.iso(model.periodo.fechaFin)}** (${model.periodo.descripcion}). ` +
        `Registraste **${this.fmtInt(movs)}** movimientos. ` +
        `Ingresos **${this.fmtMoney(ingresos, model.moneda)}**, egresos **${this.fmtMoney(gastos, model.moneda)}** y balance neto **${this.fmtMoney(balance, model.moneda)}**.`,
    );

    // =========================
    // Comparación
    // =========================
    this.startSection(doc, model, 'Comparación vs periodo anterior', 'Variación absoluta y porcentual', 170);
    const cambios = model.comparacion?.cambios ?? null;

    if (!cambios) {
      this.callout(doc, 'No disponible', 'No se pudo calcular la comparación del periodo anterior.', 'neutral');
    } else {
      this.kvTable(doc, [
        { k: 'Ingresos', v: this.formatCambioPremium(cambios.ingresos, model.moneda) },
        { k: 'Egresos', v: this.formatCambioPremium(cambios.gastos, model.moneda) },
        { k: 'Balance', v: this.formatCambioPremium(cambios.balance, model.moneda) },
        { k: 'Movimientos', v: this.formatCambioPremium(cambios.movimientos, model.moneda, { isCount: true }) },
      ]);
    }

    // =========================
    // Insights
    // =========================
    this.startSection(doc, model, 'Insights', 'Hallazgos + acciones sugeridas', 160);
    const insights = Array.isArray(model.resumen?.insights) ? model.resumen.insights : [];

    if (!insights.length) {
      this.callout(doc, 'Sin insights', 'No hay insights generados para este periodo.', 'neutral');
    } else {
      // si hay pocos, los ponemos más compactos
      for (const ins of insights.slice(0, 10)) {
        this.ensureSpace(doc, model, 110);
        this.insightCard(doc, ins);
      }
    }

    // =========================
    // Top conceptos (barras)
    // =========================
    this.startSection(doc, model, 'Top conceptos de gasto', 'Distribución por concepto', 220);
    const top = Array.isArray(model.resumen?.topConceptosGasto) ? model.resumen.topConceptosGasto : [];

    if (!top.length) {
      this.callout(doc, 'Sin datos', 'No hay conceptos de gasto para el periodo.', 'neutral');
    } else {
      const items = top.slice(0, 7).map((t: any, idx: number) => ({
        label: String(t.concepto ?? ''),
        value: this.asNumber(t.total) ?? 0,
        color: [this.THEME.palette.gold, this.THEME.palette.purple, this.THEME.palette.teal, this.THEME.palette.blue][idx % 4],
      }));

      this.ensureSpace(doc, model, 170);
      const w = doc.page.width - left - (doc.page.margins.right ?? 46);
      this.drawHorizontalBars(doc, left, doc.y, w, 24, items, model.moneda);
      doc.moveDown(6);

      // pequeña nota/tabla compacta (opcional)
      const rows = top.slice(0, 10).map((t: any) => ({
        concepto: String(t.concepto ?? ''),
        total: this.fmtMoney(this.asNumber(t.total) ?? 0, model.moneda),
        pct: this.fmtPct(t.porcentaje),
      }));
      this.tableKeyValueCompact(doc, rows, { col1Label: 'Concepto', col2Label: 'Total', col3Label: '%', w });
    }

    // =========================
    // Serie mensual (línea doble)
    // =========================
    this.startSection(doc, model, 'Serie mensual', 'Ingresos vs egresos (tendencia)', 260);
    const serie = Array.isArray(model.resumen?.serieMensual) ? model.resumen.serieMensual : [];

    if (!serie.length) {
      this.callout(doc, 'Sin datos', 'No hay serie mensual disponible para el periodo.', 'neutral');
    } else {
      const pts = serie.slice(0, 12).map((s: any) => ({
        label: String(s.mes ?? ''),
        ingresos: this.asNumber(s.ingresos) ?? 0,
        gastos: this.asNumber(s.gastos) ?? 0,
      }));

      this.ensureSpace(doc, model, 210);
      const w = doc.page.width - left - (doc.page.margins.right ?? 46);
      this.drawDualLineChart(doc, left, doc.y, w, 180, pts);
      doc.moveDown(10);
    }

    // =========================
    // Movimientos (tabla auto-height, sin solapes)
    // =========================
    if (Array.isArray(model.movimientos) && model.movimientos.length) {
      this.startSection(doc, model, 'Movimientos', 'Muestra de movimientos recientes', 280);

      // opcional: puedes filtrar eventos “internos” aquí si lo necesitas
      const rows = model.movimientos.slice(0, 800);

      const cols = [
        {
          label: 'Fecha',
          width: 78,
          align: 'left' as const,
          value: (m: any) => (m.fecha ? this.iso(m.fecha) : ''),
        },
        {
          label: 'Tipo',
          width: 62,
          align: 'center' as const,
          value: (m: any) => String(m.tipo ?? ''),
        },
        {
          label: 'Concepto',
          width: 140,
          align: 'left' as const,
          value: (m: any) => String(m.concepto?.nombre ?? ''),
        },
        {
          label: 'Descripción',
          width: 190,
          align: 'left' as const,
          value: (m: any) => String(m.descripcion ?? ''),
        },
        {
          label: 'Monto',
          width: 88,
          align: 'right' as const,
          value: (m: any) => {
            const currency = m.moneda ?? model.moneda;
            const n = this.asNumber(m.monto);
            if (n === null) return String(m.monto ?? '');
            const tipo = String(m.tipo ?? '').toLowerCase();
            const signed = tipo.includes('egre') || tipo.includes('gasto') ? -Math.abs(n) : Math.abs(n);
            return this.fmtMoney(signed, currency);
          },
        },
      ];

      this.tableAuto(doc, model, cols, rows, {
        zebra: true,
        headerRepeat: true,
        maxRowHeight: 46,
        preprocessCellText: (col, txt) => (col === 'Descripción' ? this.trunc(txt, 140) : txt),
        rowStyle: (m: any) => {
          const tipo = String(m.tipo ?? '').toLowerCase();
          if (tipo.includes('ing')) return { text: this.THEME.palette.green };
          if (tipo.includes('egr') || tipo.includes('gas')) return { text: this.THEME.palette.red };
          return { text: this.THEME.palette.ink };
        },
      });

      const totalElementos = model.movimientosMeta?.totalElementos ?? rows.length;
      if (totalElementos > rows.length) {
        this.callout(
          doc,
          'Nota',
          `Este PDF incluye una muestra de ${rows.length} movimientos (de ${totalElementos}). Para exportación completa, usa Excel o incrementa limiteMovimientos.`,
          'neutral',
        );
      }
    }

    // =========================
    // Notas
    // =========================
    this.startSection(doc, model, 'Notas y definiciones', 'Consideraciones para interpretar el reporte', 170);
    this.bullets(doc, [
      'Los montos se presentan en moneda base o en la moneda de cada movimiento, según corresponda.',
      'La comparación de periodos depende de disponibilidad del periodo anterior equivalente.',
      'Los insights se generan a partir de patrones detectados y pueden variar según los datos.',
      'Para análisis avanzado, exporta a Excel (más detalle y hojas auxiliares).',
    ]);

    // Footers al final (SAFE, sin crear páginas extra)
    this.addPdfFootersSafe(doc, model);

    doc.end();
    return endPromise;
  }

  // ============================================================
  // PDF helpers (layout + premium UI)
  // ============================================================

  private pageBottom(doc: PDFKit.PDFDocument) {
    return doc.page.height - (doc.page.margins.bottom ?? 62);
  }

  private ensureSpace(doc: PDFKit.PDFDocument, model: any, needed: number) {
    if (doc.y + needed > this.pageBottom(doc)) {
      doc.addPage();
      this.pdfHeader(doc, model, { compact: true });
    }
  }

  private startSection(doc: PDFKit.PDFDocument, model: any, title: string, subtitle?: string, minHeight = 140) {
    this.ensureSpace(doc, model, minHeight);
    this.sectionTitle(doc, title, subtitle);
  }

  private pdfCover(doc: PDFKit.PDFDocument, model: any) {
    const left = doc.page.margins.left ?? 46;
    const right = doc.page.width - (doc.page.margins.right ?? 46);

    // Fondo limpio
    doc.save();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(this.THEME.palette.paper);

    // Banda superior premium
    doc.fillColor(this.THEME.palette.navy);
    doc.rect(0, 0, doc.page.width, 140).fill();

    // Detalle dorado
    doc.fillColor(this.THEME.palette.gold);
    doc.rect(0, 140, doc.page.width, 6).fill();

    // Brand + título
    doc.fillColor('#FFFFFF').font(this.THEME.pdf.font.bold).fontSize(22);
    doc.text(this.THEME.brand, left, 50, { width: right - left, align: 'left', lineBreak: false });

    doc.font(this.THEME.pdf.font.bold).fontSize(28);
    doc.text('Reporte Financiero', left, 86, { width: right - left, align: 'left', lineBreak: false });

    // Panel info
    const panelY = 200;
    doc.fillColor(this.THEME.palette.bgSoft);
    doc.roundedRect(left, panelY, right - left, 200, 18).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
    doc.roundedRect(left, panelY, right - left, 200, 18).stroke();

    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(12);
    doc.text('Resumen del documento', left + 18, panelY + 18, { width: right - left - 36 });

    doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(10);
    doc.text(`Generado: ${model.generatedAt.toISOString()}`, left + 18, panelY + 52, { width: right - left - 36 });
    doc.text(`Usuario: ${model.user.nombre}${model.user.email ? ` (${model.user.email})` : ''}`, left + 18, panelY + 70, {
      width: right - left - 36,
    });
    doc.text(
      `Periodo: ${this.iso(model.periodo.fechaInicio)} → ${this.iso(model.periodo.fechaFin)}  •  ${model.periodo.descripcion}`,
      left + 18,
      panelY + 88,
      { width: right - left - 36 },
    );
    doc.text(`Moneda base: ${model.moneda}`, left + 18, panelY + 122, { width: right - left - 36 });

    // Nota de confidencialidad (ABSOLUTA y segura — no empuja página)
    const yFooter = doc.page.height - (doc.page.margins.bottom ?? 62) + 18;
    doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9);
    doc.text('Confidencial • Uso personal • LitFinance', left, yFooter, {
      width: right - left,
      align: 'left',
      lineBreak: false,
      height: 10,
    });

    doc.restore();
  }

  private pdfHeader(doc: PDFKit.PDFDocument, model: any, opts?: { compact?: boolean }) {
    const left = doc.page.margins.left ?? 46;
    const right = doc.page.width - (doc.page.margins.right ?? 46);
    const w = right - left;

    const barH = opts?.compact ? 44 : 54;
    const y0 = (doc.page.margins.top ?? 54) - barH + 10;

    doc.save();

    // header bar
    doc.fillColor(this.THEME.palette.bgSoft);
    doc.roundedRect(left, y0, w, barH, 14).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
    doc.roundedRect(left, y0, w, barH, 14).stroke();

    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(opts?.compact ? 12 : 13);
    doc.text(this.THEME.brand, left + 14, y0 + 12, { width: 160, lineBreak: false });

    doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9);
    doc.text(model.title, left + 14, y0 + (opts?.compact ? 26 : 28), { width: 220, lineBreak: false });

    doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9);
    doc.text(
      `${this.iso(model.periodo.fechaInicio)} → ${this.iso(model.periodo.fechaFin)}`,
      left,
      y0 + 16,
      { width: w - 14, align: 'right', lineBreak: false },
    );

    doc.restore();

    // ajustar cursor debajo del header
    doc.y = y0 + barH + 18;
  }

  private sectionTitle(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
    const left = doc.page.margins.left ?? 46;
    const right = doc.page.width - (doc.page.margins.right ?? 46);
    const w = right - left;

    this.ensureSpace(doc, { periodo: {} } as any, subtitle ? 70 : 54);

    doc.save();

    const y = doc.y;
    doc.fillColor(this.THEME.palette.paper);
    doc.roundedRect(left, y, w, subtitle ? 54 : 44, 14).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
    doc.roundedRect(left, y, w, subtitle ? 54 : 44, 14).stroke();

    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(13);
    doc.text(title, left + 14, y + 12, { width: w - 28 });

    if (subtitle) {
      doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9.5);
      doc.text(subtitle, left + 14, y + 30, { width: w - 28 });
    }

    doc.restore();
    doc.y = y + (subtitle ? 66 : 56);
  }

  private kpiCards(
    doc: PDFKit.PDFDocument,
    cards: Array<{ label: string; value: string; tone: 'blue' | 'red' | 'green' | 'neutral' }>,
  ) {
    const left = doc.page.margins.left ?? 46;
    const right = doc.page.width - (doc.page.margins.right ?? 46);
    const w = right - left;

    // grid 2x2
    const gap = 12;
    const cardW = (w - gap) / 2;
    const cardH = 64;

    const colors = {
      blue: this.THEME.palette.blue,
      red: this.THEME.palette.red,
      green: this.THEME.palette.green,
      neutral: this.THEME.palette.navy,
    } as const;

    this.ensureSpace(doc, { periodo: {} } as any, cardH * 2 + gap + 20);

    const startY = doc.y;

    for (let i = 0; i < Math.min(cards.length, 4); i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;

      const x = left + col * (cardW + gap);
      const y = startY + row * (cardH + gap);

      const c = cards[i];
      const tone = colors[c.tone];

      doc.save();
      doc.fillColor(this.THEME.palette.bgSoft);
      doc.roundedRect(x, y, cardW, cardH, 16).fill();
      doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
      doc.roundedRect(x, y, cardW, cardH, 16).stroke();

      // barra lateral
      doc.fillColor(tone);
      doc.roundedRect(x + 10, y + 12, 6, cardH - 24, 6).fill();

      doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9.5);
      doc.text(c.label, x + 24, y + 14, { width: cardW - 36, lineBreak: false });

      doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(13);
      doc.text(c.value, x + 24, y + 32, { width: cardW - 36, lineBreak: false });

      doc.restore();
    }

    doc.y = startY + cardH * 2 + gap + 8;
  }

  private callout(doc: PDFKit.PDFDocument, title: string, body: string, tone: 'neutral' | 'warn' | 'good') {
    const left = doc.page.margins.left ?? 46;
    const right = doc.page.width - (doc.page.margins.right ?? 46);
    const w = right - left;

    const barColor =
      tone === 'good' ? this.THEME.palette.green : tone === 'warn' ? this.THEME.palette.gold : this.THEME.palette.navy;

    this.ensureSpace(doc, { periodo: {} } as any, 86);

    const y = doc.y;
    doc.save();

    doc.fillColor(this.THEME.palette.bgSoft);
    doc.roundedRect(left, y, w, 70, 16).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
    doc.roundedRect(left, y, w, 70, 16).stroke();

    doc.fillColor(barColor);
    doc.roundedRect(left + 10, y + 12, 6, 46, 6).fill();

    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(11);
    doc.text(title, left + 24, y + 12, { width: w - 36, lineBreak: false });

    doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9.5);
    doc.text(body, left + 24, y + 30, { width: w - 36 });

    doc.restore();
    doc.y = y + 84;
  }

  private bullets(doc: PDFKit.PDFDocument, items: string[]) {
    const left = doc.page.margins.left ?? 46;
    const right = doc.page.width - (doc.page.margins.right ?? 46);
    const w = right - left;

    doc.save();
    doc.font(this.THEME.pdf.font.regular).fontSize(10).fillColor(this.THEME.palette.ink);

    for (const t of items) {
      this.ensureSpace(doc, { periodo: {} } as any, 22);
      const y = doc.y;
      doc.fillColor(this.THEME.palette.gold).circle(left + 4, y + 6, 2.2).fill();
      doc.fillColor(this.THEME.palette.ink).text(t, left + 14, y, { width: w - 14 });
      doc.moveDown(0.45);
    }

    doc.restore();
    doc.moveDown(0.3);
  }

  private insightCard(doc: PDFKit.PDFDocument, ins: any) {
    const left = doc.page.margins.left ?? 46;
    const right = doc.page.width - (doc.page.margins.right ?? 46);
    const w = right - left;

    const titulo = String(ins?.titulo ?? 'Insight');
    const desc = String(ins?.descripcion ?? '');
    const accion = String(ins?.accionSugerida ?? '');

    this.ensureSpace(doc, { periodo: {} } as any, 110);

    const y = doc.y;
    doc.save();

    doc.fillColor(this.THEME.palette.paper);
    doc.roundedRect(left, y, w, 92, 16).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
    doc.roundedRect(left, y, w, 92, 16).stroke();

    // badge prioridad
    const pr = String(ins?.prioridad ?? '').toLowerCase();
    const badgeColor =
      pr.includes('alta') ? this.THEME.palette.red : pr.includes('media') ? this.THEME.palette.gold : this.THEME.palette.teal;

    doc.fillColor(badgeColor);
    doc.roundedRect(left + 14, y + 14, 62, 18, 9).fill();
    doc.fillColor('#FFFFFF').font(this.THEME.pdf.font.bold).fontSize(9);
    doc.text(pr ? pr.toUpperCase() : 'INSIGHT', left + 14, y + 18, { width: 62, align: 'center', lineBreak: false });

    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(11);
    doc.text(titulo, left + 88, y + 14, { width: w - 102, lineBreak: false });

    doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9.5);
    doc.text(this.trunc(desc, 180), left + 14, y + 38, { width: w - 28 });

    if (accion) {
      doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(9.5);
      doc.text('Acción sugerida:', left + 14, y + 66, { width: 120, lineBreak: false });

      doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9.5);
      doc.text(this.trunc(accion, 160), left + 118, y + 66, { width: w - 132 });
    }

    doc.restore();
    doc.y = y + 110;
  }

  private kvTable(doc: PDFKit.PDFDocument, rows: Array<{ k: string; v: string }>) {
    const left = doc.page.margins.left ?? 46;
    const right = doc.page.width - (doc.page.margins.right ?? 46);
    const w = right - left;

    this.ensureSpace(doc, { periodo: {} } as any, 120);

    const y = doc.y;
    const rowH = 24;

    doc.save();

    doc.fillColor(this.THEME.palette.bgSoft);
    doc.roundedRect(left, y, w, rows.length * rowH + 18, 16).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
    doc.roundedRect(left, y, w, rows.length * rowH + 18, 16).stroke();

    doc.font(this.THEME.pdf.font.bold).fontSize(10).fillColor(this.THEME.palette.muted);
    doc.text('Métrica', left + 14, y + 10, { width: 200, lineBreak: false });
    doc.text('Variación', left + 14, y + 10, { width: w - 28, align: 'right', lineBreak: false });

    let yy = y + 32;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      if (i % 2 === 1) {
        doc.fillColor(this.THEME.palette.rowAlt);
        doc.rect(left + 10, yy - 2, w - 20, rowH).fill();
      }

      doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(10);
      doc.text(r.k, left + 14, yy + 4, { width: 220, lineBreak: false });

      doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.regular).fontSize(10);
      doc.text(r.v, left + 14, yy + 4, { width: w - 28, align: 'right', lineBreak: false });

      yy += rowH;
    }

    doc.restore();
    doc.y = y + rows.length * rowH + 30;
  }

  private tableKeyValueCompact(
    doc: PDFKit.PDFDocument,
    rows: Array<{ concepto: string; total: string; pct: string }>,
    opts: { col1Label: string; col2Label: string; col3Label: string; w: number },
  ) {
    const left = doc.page.margins.left ?? 46;
    const w = opts.w;

    this.ensureSpace(doc, { periodo: {} } as any, 170);

    const col1 = Math.floor(w * 0.56);
    const col2 = Math.floor(w * 0.27);
    const col3 = w - col1 - col2;

    // header
    doc.save();
    doc.fillColor(this.THEME.palette.navy).roundedRect(left, doc.y, w, 22, 10).fill();
    doc.fillColor('#FFFFFF').font(this.THEME.pdf.font.bold).fontSize(10);

    doc.text(opts.col1Label, left + 10, doc.y + 6, { width: col1 - 16, lineBreak: false });
    doc.text(opts.col2Label, left + col1, doc.y + 6, { width: col2 - 16, align: 'right', lineBreak: false });
    doc.text(opts.col3Label, left + col1 + col2, doc.y + 6, { width: col3 - 16, align: 'right', lineBreak: false });

    doc.restore();
    doc.y += 30;

    const rowH = 18;
    for (let i = 0; i < rows.length; i++) {
      this.ensureSpace(doc, { periodo: {} } as any, 26);

      if (i % 2 === 1) {
        doc.save();
        doc.fillColor(this.THEME.palette.rowAlt);
        doc.rect(left, doc.y - 2, w, rowH + 4).fill();
        doc.restore();
      }

      doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.regular).fontSize(9.5);
      doc.text(this.trunc(rows[i].concepto, 36), left + 10, doc.y + 2, { width: col1 - 16, lineBreak: false });
      doc.text(rows[i].total, left + col1, doc.y + 2, { width: col2 - 16, align: 'right', lineBreak: false });
      doc.text(rows[i].pct, left + col1 + col2, doc.y + 2, { width: col3 - 16, align: 'right', lineBreak: false });

      doc.y += rowH;
    }

    doc.moveDown(0.6);
  }

  /** Donut chart premium */
  private drawDonut(
    doc: PDFKit.PDFDocument,
    cx: number,
    cy: number,
    r: number,
    thickness: number,
    segments: { value: number; color: string; label: string }[],
  ) {
    const total = segments.reduce((a, s) => a + Math.max(0, s.value || 0), 0) || 1;
    let angle = -Math.PI / 2;

    doc.save();
    doc.lineWidth(thickness).lineCap('round');

    for (const s of segments) {
      const v = Math.max(0, s.value || 0);
      const a = (v / total) * Math.PI * 2;

      doc.strokeColor(s.color);
      this.drawArc(doc, cx, cy, r, angle, angle + a);

      angle += a;
    }

    // centro
    doc.fillColor(this.THEME.palette.paper);
    doc.circle(cx, cy, r - thickness / 2 - 2).fill();
    doc.restore();
  }

  /** Helper to draw arc since PDFKit doesn't have native arc method */
  private drawArc(
    doc: PDFKit.PDFDocument,
    cx: number,
    cy: number,
    r: number,
    startAngle: number,
    endAngle: number,
  ) {
    const startX = cx + r * Math.cos(startAngle);
    const startY = cy + r * Math.sin(startAngle);

    const endX = cx + r * Math.cos(endAngle);
    const endY = cy + r * Math.sin(endAngle);

    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    doc.moveTo(startX, startY);
    (doc as any).arcTo(endX, endY, r);
    doc.stroke();
  }

  /** Barras horizontales premium */
  private drawHorizontalBars(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    rowH: number,
    items: { label: string; value: number; color: string }[],
    moneda: string,
  ) {
    const max = Math.max(1, ...items.map((i) => i.value || 0));

    doc.save();
    doc.font(this.THEME.pdf.font.regular).fontSize(10);

    // panel
    doc.fillColor(this.THEME.palette.bgSoft);
    doc.roundedRect(x, y, w, items.length * rowH + 18, 16).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
    doc.roundedRect(x, y, w, items.length * rowH + 18, 16).stroke();

    let yy = y + 12;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];

      // label
      doc.fillColor(this.THEME.palette.ink);
      doc.text(this.trunc(it.label, 28), x + 14, yy, { width: 160, lineBreak: false });

      // bar bg
      doc.fillColor(this.THEME.palette.subtle);
      doc.roundedRect(x + 180, yy + 4, w - 270, 10, 6).fill();

      // bar fg
      const bw = ((w - 270) * (it.value || 0)) / max;
      doc.fillColor(it.color);
      doc.roundedRect(x + 180, yy + 4, Math.max(2, bw), 10, 6).fill();

      // value
      doc.fillColor(this.THEME.palette.muted);
      doc.text(this.fmtMoney(it.value, moneda), x + w - 80, yy, { width: 66, align: 'right', lineBreak: false });

      yy += rowH;
    }

    doc.restore();
    doc.y = y + items.length * rowH + 32;
  }

  /** Línea doble (ingresos vs egresos) */
  private drawDualLineChart(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    points: { label: string; ingresos: number; gastos: number }[],
  ) {
    const pad = 12;
    const plotX = x + pad;
    const plotY = y + pad;
    const plotW = w - pad * 2;
    const plotH = h - pad * 2;

    const maxVal = Math.max(1, ...points.map((p) => Math.max(p.ingresos || 0, p.gastos || 0)));

    const toXY = (idx: number, val: number) => {
      const px = plotX + (plotW * idx) / Math.max(1, points.length - 1);
      const py = plotY + plotH - (plotH * (val || 0)) / maxVal;
      return { px, py };
    };

    doc.save();

    // panel
    doc.fillColor(this.THEME.palette.bgSoft).roundedRect(x, y, w, h, 16).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1).roundedRect(x, y, w, h, 16).stroke();

    // grid
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(0.6);
    for (let i = 0; i <= 4; i++) {
      const gy = plotY + (plotH * i) / 4;
      doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).stroke();
    }

    const drawSeries = (key: 'ingresos' | 'gastos', color: string) => {
      doc.strokeColor(color).lineWidth(2);
      points.forEach((p, idx) => {
        const { px, py } = toXY(idx, p[key]);
        if (idx === 0) doc.moveTo(px, py);
        else doc.lineTo(px, py);
      });
      doc.stroke();

      doc.fillColor(color);
      points.forEach((p, idx) => {
        const { px, py } = toXY(idx, p[key]);
        doc.circle(px, py, 2.6).fill();
      });
    };

    drawSeries('ingresos', this.THEME.palette.blue);
    drawSeries('gastos', this.THEME.palette.red);

    // labels (solo primero y último)
    doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9);
    const first = points[0]?.label ?? '';
    const last = points[points.length - 1]?.label ?? '';
    doc.text(first, plotX, y + h - 18, { width: 90, align: 'left', lineBreak: false });
    doc.text(last, plotX + plotW - 90, y + h - 18, { width: 90, align: 'right', lineBreak: false });

    // mini leyenda
    doc.fillColor(this.THEME.palette.blue).circle(x + 16, y + 14, 3).fill();
    doc.fillColor(this.THEME.palette.muted).text('Ingresos', x + 24, y + 10, { width: 90, lineBreak: false });

    doc.fillColor(this.THEME.palette.red).circle(x + 100, y + 14, 3).fill();
    doc.fillColor(this.THEME.palette.muted).text('Egresos', x + 108, y + 10, { width: 90, lineBreak: false });

    doc.restore();

    doc.y = y + h + 18;
  }

  /**
   * Tabla auto-height (sin solapes) + header repeat.
   * FIX: jamás dibuja header si no hay filas.
   */
  private tableAuto<T>(
    doc: PDFKit.PDFDocument,
    model: any,
    cols: Array<{ label: string; width: number; align?: 'left' | 'center' | 'right'; value: (row: T) => string }>,
    rows: T[],
    opts?: {
      zebra?: boolean;
      headerRepeat?: boolean;
      afterRow?: (row: T, yTop: number, rowH: number, colX: number[]) => void;
      rowStyle?: (row: T) => { text?: string };
      maxRowHeight?: number;
      preprocessCellText?: (colLabel: string, txt: string) => string;
    },
  ) {
    if (!rows.length) return;

    const left = doc.page.margins.left ?? 46;
    const usableW = doc.page.width - left - (doc.page.margins.right ?? 46);

    // Ajuste proporcional si no encaja
    const sumW = cols.reduce((a, c) => a + c.width, 0);
    if (Math.abs(sumW - usableW) > 2) {
      const scale = usableW / sumW;
      cols = cols.map((c) => ({ ...c, width: Math.max(54, Math.floor(c.width * scale)) }));
    }

    const x0 = left;
    const colX: number[] = [];
    let acc = x0;
    for (const c of cols) {
      colX.push(acc);
      acc += c.width;
    }

    const drawHeader = () => {
      this.ensureSpace(doc, model, 44);
      const y = doc.y;
      const h = 22;

      doc.save();
      doc.fillColor(this.THEME.palette.navy).roundedRect(x0, y, usableW, h, 10).fill();
      doc.fillColor('#FFFFFF').font(this.THEME.pdf.font.bold).fontSize(10);

      for (let i = 0; i < cols.length; i++) {
        doc.text(cols[i].label, colX[i] + 8, y + 6, {
          width: cols[i].width - 16,
          align: cols[i].align ?? 'left',
          lineBreak: false,
        });
      }

      doc.restore();
      doc.y = y + h + 8;
    };

    drawHeader();

    const baseFontSize = 9.5;
    const padY = 6;

    let idx = 0;
    for (const r of rows) {
      const style = opts?.rowStyle?.(r) ?? {};
      doc.font(this.THEME.pdf.font.regular).fontSize(baseFontSize);

      let rowH = 18;
      const texts: string[] = [];

      for (let i = 0; i < cols.length; i++) {
        const raw = String(cols[i].value(r) ?? '');
        const txt = opts?.preprocessCellText ? opts.preprocessCellText(cols[i].label, raw) : raw;
        texts.push(txt);

        const h = doc.heightOfString(txt, {
          width: cols[i].width - 16,
          align: cols[i].align ?? 'left',
        });

        rowH = Math.max(rowH, h + padY);
      }

      if (opts?.maxRowHeight) rowH = Math.min(rowH, opts.maxRowHeight);

      // Page break
      if (doc.y + rowH + 24 > this.pageBottom(doc)) {
        doc.addPage();
        this.pdfHeader(doc, model, { compact: true });
        if (opts?.headerRepeat !== false) drawHeader();
      }

      const yTop = doc.y;

      // zebra
      if (opts?.zebra && idx % 2 === 1) {
        doc.save();
        doc.fillColor(this.THEME.palette.rowAlt);
        doc.rect(x0, yTop - 2, usableW, rowH + 4).fill();
        doc.restore();
      }

      // border
      doc.save();
      doc.strokeColor(this.THEME.palette.subtle).lineWidth(0.6);
      doc.moveTo(x0, yTop + rowH + 2).lineTo(x0 + usableW, yTop + rowH + 2).stroke();
      doc.restore();

      doc.fillColor(style.text ?? this.THEME.palette.ink);

      for (let i = 0; i < cols.length; i++) {
        doc.text(texts[i], colX[i] + 8, yTop + 4, {
          width: cols[i].width - 16,
          align: cols[i].align ?? 'left',
        });
      }

      opts?.afterRow?.(r, yTop, rowH, colX);

      doc.y = yTop + rowH + 6;
      idx++;
    }

    doc.moveDown(0.4);
  }

  /** Footer SAFE: no crea páginas en blanco y no altera el flow */
  private addPdfFootersSafe(doc: PDFKit.PDFDocument, model: any) {
    const range = doc.bufferedPageRange();
    const leftMargin = doc.page.margins.left ?? 46;
    const rightMargin = doc.page.margins.right ?? 46;
    const bottomMargin = doc.page.margins.bottom ?? 62;

    // Opcional: no footer en portada
    const coverIndex = range.start; // primera página

    // Paginación empieza en 1 a partir de la primera página de contenido
    const totalContentPages = Math.max(0, range.count - 1);

    for (let i = range.start; i < range.start + range.count; i++) {
      if (i === coverIndex) continue;

      doc.switchToPage(i);

      const w = doc.page.width - leftMargin - rightMargin;
      const y = doc.page.height - bottomMargin + 18;

      const oldX = doc.x;
      const oldY = doc.y;

      doc.save();

      doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
      doc.moveTo(leftMargin, y - 10).lineTo(leftMargin + w, y - 10).stroke();

      doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9);

      const leftText = `${this.THEME.brand} • ${this.iso(model.periodo.fechaInicio)} → ${this.iso(model.periodo.fechaFin)}`;
      const pageNo = i - coverIndex; // 1..N
      const rightText = `Página ${pageNo} de ${totalContentPages}`;

      // IMPORTANTE: x,y siempre + lineBreak:false
      doc.text(leftText, leftMargin, y, { width: w, align: 'left', lineBreak: false, height: 10 });
      doc.text(rightText, leftMargin, y, { width: w, align: 'right', lineBreak: false, height: 10 });

      doc.restore();

      doc.x = oldX;
      doc.y = oldY;
    }

    // volver a última página
    doc.switchToPage(range.start + range.count - 1);
  }

  // ============================================================
  // Text helpers
  // ============================================================

  private richParagraph(doc: PDFKit.PDFDocument, text: string) {
    // soporte súper simple de **bold** sin librerías: render por chunks
    const left = doc.page.margins.left ?? 46;
    const right = doc.page.width - (doc.page.margins.right ?? 46);
    const w = right - left;

    this.ensureSpace(doc, { periodo: {} } as any, 70);

    const parts = String(text).split('**');
    doc.save();
    doc.fillColor(this.THEME.palette.muted).fontSize(10);

    let x = left;
    let y = doc.y;

    // medimos en la misma línea y hacemos wrap manual por palabras
    const write = (txt: string, bold: boolean) => {
      const words = txt.split(/\s+/).filter(Boolean);
      for (const word of words) {
        const wWord = doc
          .font(bold ? this.THEME.pdf.font.bold : this.THEME.pdf.font.regular)
          .widthOfString(word + ' ');
        if (x + wWord > left + w) {
          x = left;
          y += 14;
          this.ensureSpace(doc, { periodo: {} } as any, 30);
        }
        doc
          .font(bold ? this.THEME.pdf.font.bold : this.THEME.pdf.font.regular)
          .text(word + ' ', x, y, { lineBreak: false });
        x += wWord;
      }
    };

    for (let i = 0; i < parts.length; i++) {
      const bold = i % 2 === 1;
      write(parts[i], bold);
    }

    doc.restore();
    doc.y = y + 20;
    doc.moveDown(0.4);
  }

  private trunc(s: string, max: number) {
    const str = String(s ?? '');
    if (str.length <= max) return str;
    return str.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
  }

  private iso(d: any) {
    const dt = new Date(d);
    return toIsoDateOnly(dt);
  }

  private asNumber(v: any): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  private fmtInt(n: any): string {
    const v = this.asNumber(n) ?? 0;
    return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(v);
  }

  private fmtPct(p: any): string {
    const n = this.asNumber(p);
    if (n === null) return '';
    return `${n.toFixed(1)}%`;
  }

  private fmtMoney(n: any, currency: string): string {
    const v = this.asNumber(n);
    if (v === null) return String(n ?? '');
    // no usamos currencyDisplay porque a veces mete símbolos raros; lo dejamos controlado
    const num = new Intl.NumberFormat('es-MX', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
    return `${num} ${currency}`;
  }

  private formatCambioPremium(c: any, currency: string, opts?: { isCount?: boolean }): string {
    if (!c) return '0';
    const abs = this.asNumber(c.absoluto) ?? 0;
    const pct = this.asNumber(c.porcentual) ?? 0;
    const absStr = opts?.isCount ? this.fmtInt(abs) : this.fmtMoney(abs, currency);
    const pctStr = `${pct.toFixed(1)}%`;
    return `${absStr} (${pctStr})`;
  }

  // ============================================================
  // XLSX (dejas tu versión base, con un poquito más de estilo)
  // ============================================================

  private async generarXlsx(model: any): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = this.THEME.brand;
    wb.created = model.generatedAt;

    const wsResumen = wb.addWorksheet('Resumen', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsResumen.columns = [
      { header: 'Campo', key: 'campo', width: 28 },
      { header: 'Valor', key: 'valor', width: 60 },
    ];

    wsResumen.getRow(1).font = { bold: true };
    wsResumen.getRow(1).alignment = { vertical: 'middle' };
    wsResumen.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } };
    wsResumen.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    wsResumen.addRow({ campo: 'Generado', valor: model.generatedAt.toISOString() });
    wsResumen.addRow({ campo: 'Usuario', valor: `${model.user.nombre}${model.user.email ? ` (${model.user.email})` : ''}` });
    wsResumen.addRow({
      campo: 'Periodo',
      valor: `${toIsoDateOnly(new Date(model.periodo.fechaInicio))} a ${toIsoDateOnly(new Date(model.periodo.fechaFin))}`,
    });
    wsResumen.addRow({ campo: 'Descripción', valor: model.periodo.descripcion });
    wsResumen.addRow({ campo: 'Moneda base', valor: model.moneda });

    wsResumen.addRow({ campo: 'Ingresos', valor: model.resumen.totales.ingresos });
    wsResumen.addRow({ campo: 'Gastos', valor: model.resumen.totales.gastos });
    wsResumen.addRow({ campo: 'Balance', valor: model.resumen.totales.balance });
    wsResumen.addRow({ campo: 'Movimientos', valor: model.resumen.totales.movimientos });

    const cambios = model.comparacion?.cambios;
    if (cambios) {
      wsResumen.addRow({ campo: 'Δ Ingresos (abs)', valor: cambios.ingresos?.absoluto ?? '' });
      wsResumen.addRow({ campo: 'Δ Ingresos (%)', valor: cambios.ingresos?.porcentual ?? '' });
      wsResumen.addRow({ campo: 'Δ Gastos (abs)', valor: cambios.gastos?.absoluto ?? '' });
      wsResumen.addRow({ campo: 'Δ Gastos (%)', valor: cambios.gastos?.porcentual ?? '' });
      wsResumen.addRow({ campo: 'Δ Balance (abs)', valor: cambios.balance?.absoluto ?? '' });
      wsResumen.addRow({ campo: 'Δ Balance (%)', valor: cambios.balance?.porcentual ?? '' });
    }

    const wsInsights = wb.addWorksheet('Insights');
    wsInsights.columns = [
      { header: 'Prioridad', key: 'prioridad', width: 14 },
      { header: 'Título', key: 'titulo', width: 32 },
      { header: 'Descripción', key: 'desc', width: 80 },
      { header: 'Acción sugerida', key: 'accion', width: 40 },
    ];
    wsInsights.getRow(1).font = { bold: true };
    for (const ins of model.resumen.insights ?? []) {
      wsInsights.addRow({
        prioridad: ins.prioridad ?? '',
        titulo: ins.titulo ?? '',
        desc: ins.descripcion ?? '',
        accion: ins.accionSugerida ?? '',
      });
    }

    const wsSerie = wb.addWorksheet('SerieMensual');
    wsSerie.columns = [
      { header: 'Mes', key: 'mes', width: 12 },
      { header: 'Ingresos', key: 'ing', width: 14 },
      { header: 'Gastos', key: 'gas', width: 14 },
      { header: 'Balance', key: 'bal', width: 14 },
      { header: 'Movimientos', key: 'mov', width: 14 },
    ];
    wsSerie.getRow(1).font = { bold: true };
    for (const s of model.resumen.serieMensual ?? []) {
      wsSerie.addRow({ mes: s.mes, ing: s.ingresos, gas: s.gastos, bal: s.balance, mov: s.movimientos });
    }

    const wsTop = wb.addWorksheet('TopConceptosGasto');
    wsTop.columns = [
      { header: 'Concepto', key: 'concepto', width: 36 },
      { header: 'Total', key: 'total', width: 16 },
      { header: 'Porcentaje', key: 'pct', width: 14 },
      { header: 'Movimientos', key: 'mov', width: 14 },
    ];
    wsTop.getRow(1).font = { bold: true };
    for (const t of model.resumen.topConceptosGasto ?? []) {
      wsTop.addRow({ concepto: t.concepto, total: t.total, pct: t.porcentaje, mov: t.movimientos });
    }

    const wsRec = wb.addWorksheet('Recurrentes');
    wsRec.columns = [
      { header: 'Recurrente', key: 'nombre', width: 36 },
      { header: 'Total', key: 'total', width: 16 },
      { header: 'Porcentaje', key: 'pct', width: 14 },
      { header: 'Cargos', key: 'cargos', width: 14 },
    ];
    wsRec.getRow(1).font = { bold: true };
    for (const r of model.resumen.recurrentes ?? []) {
      wsRec.addRow({ nombre: r.nombre, total: r.total, pct: r.porcentaje, cargos: r.cargos });
    }

    if (model.movimientos?.length) {
      const wsMov = wb.addWorksheet('Movimientos', { views: [{ state: 'frozen', ySplit: 1 }] });
      wsMov.columns = [
        { header: 'Fecha', key: 'fecha', width: 14 },
        { header: 'Tipo', key: 'tipo', width: 10 },
        { header: 'Concepto', key: 'concepto', width: 26 },
        { header: 'Subcuenta', key: 'subcuenta', width: 20 },
        { header: 'Descripción', key: 'desc', width: 44 },
        { header: 'Monto', key: 'monto', width: 16 },
        { header: 'Moneda', key: 'moneda', width: 10 },
      ];

      for (const m of model.movimientos) {
        wsMov.addRow({
          fecha: m.fecha ? toIsoDateOnly(new Date(m.fecha)) : '',
          tipo: m.tipo,
          concepto: m.concepto?.nombre ?? '',
          subcuenta: m.subcuenta?.nombre ?? '',
          desc: m.descripcion ?? '',
          monto: m.monto,
          moneda: m.moneda ?? model.moneda,
        });
      }

      wsMov.getRow(1).font = { bold: true };
    }

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as any);
  }

  // =========================
  // Formatting helpers
  // =========================

  private maxNumber(values: any[]): number {
    let m = 0;
    for (const v of values) {
      const n = this.asNumber(v);
      if (n !== null) m = Math.max(m, n);
    }
    return m;
  }

  private excelHeaderRow(row: ExcelJS.Row) {
    row.font = { bold: true, color: { argb: this.THEME.excel.headerFont } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.THEME.excel.headerFill } };
    row.alignment = { vertical: 'middle' };
    row.height = 20;
    row.eachCell((cell) => {
      cell.border = this.excelThinBorder();
    });
  }

  private excelThinBorder(): ExcelJS.Borders {
    return {
      top: { style: 'thin', color: { argb: this.THEME.excel.border } },
      left: { style: 'thin', color: { argb: this.THEME.excel.border } },
      bottom: { style: 'thin', color: { argb: this.THEME.excel.border } },
      right: { style: 'thin', color: { argb: this.THEME.excel.border } },
      diagonal: {},
    };
  }

  private excelCurrencyFormat(currency: string): string {
    const code = String(currency || 'MXN').toUpperCase();
    const symbol = this.currencySymbol(code);
    // Excel: si no hay símbolo conocido, lo dejamos como "CODE "
    if (symbol) return `"${symbol}"#,##0.00;[Red]-"${symbol}"#,##0.00`;
    return `#,##0.00" ${code}";[Red]-#,##0.00" ${code}"`;
  }

  private currencySymbol(code: string): string | null {
    switch (code) {
      case 'MXN':
      case 'USD':
      case 'CAD':
      case 'AUD':
        return '$';
      case 'EUR':
        return '€';
      case 'GBP':
        return '£';
      case 'JPY':
        return '¥';
      default:
        return null;
    }
  }
}
