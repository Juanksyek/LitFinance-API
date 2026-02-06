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

type TableColumn<T> = {
  label: string;
  width: number; // pts
  align?: 'left' | 'center' | 'right';
  value: (row: T) => string;
};

@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);

  // === “Premium theme” (PDF + Excel) ===
  private readonly THEME = {
    brand: 'LitFinance',
    palette: {
      ink: '#0B1220',
      muted: '#475569',
      subtle: '#E2E8F0',
      paper: '#FFFFFF',
      bgSoft: '#F8FAFC',
      navy: '#0F172A',
      navy2: '#111C33',
      gold: '#F59E0B',
      green: '#16A34A',
      red: '#DC2626',
      blue: '#2563EB',
      purple: '#7C3AED',
      teal: '#0D9488',
      rowAlt: '#F1F5F9',
    },
    pdf: {
      margin: 46,
      lineHeight: 1.18,
      font: {
        regular: 'Helvetica',
        bold: 'Helvetica-Bold',
        mono: 'Courier',
      },
    },
    excel: {
      tableTheme: 'TableStyleMedium9',
      headerFill: '0F172A',
      headerFont: 'FFFFFF',
      titleFill: '0B1220',
      titleFont: 'FFFFFF',
      accent: 'F59E0B',
      subtleFill: 'F8FAFC',
      border: 'E2E8F0',
      good: '16A34A',
      bad: 'DC2626',
      info: '2563EB',
    },
  };

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

    const fechaInicio = new Date(resumenInteligente?.periodo?.fechaInicio ?? q.fechaInicio ?? new Date());
    const fechaFin = new Date(resumenInteligente?.periodo?.fechaFin ?? q.fechaFin ?? new Date());

    const nombre = (perfil as any)?.nombreCompleto ?? (perfil as any)?.nombre ?? 'Usuario';
    const moneda = resumenInteligente?.moneda ?? q.monedaBase ?? (perfil as any)?.monedaPrincipal ?? 'MXN';

    const model = {
      title: 'Reporte Financiero',
      generatedAt: new Date(),
      user: {
        id: userId,
        nombre,
        email: (perfil as any)?.email ?? null,
      },
      periodo: {
        fechaInicio,
        fechaFin,
        descripcion: resumenInteligente?.periodo?.descripcion ?? 'Periodo seleccionado',
      },
      moneda,
      resumen: resumenInteligente ?? {},
      comparacion: comparacion ?? null,
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

  // =========================
  // PDF (Premium layout)
  // =========================
  private async generarPdf(model: any): Promise<Buffer> {
    const M = this.THEME.pdf.margin;

    const doc = new PDFDocument({
      size: 'A4',
      margin: M,
      bufferPages: true, // <-- para agregar footers al final
      info: {
        Title: `${this.THEME.brand} | ${model.title}`,
        Author: this.THEME.brand,
        Subject: `Reporte ${model.title} (${toIsoDateOnly(new Date(model.periodo.fechaInicio))} - ${toIsoDateOnly(
          new Date(model.periodo.fechaFin),
        )})`,
        Keywords: 'LitFinance, reporte, finanzas, movimientos, analytics',
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

    // --- Portada ---
    this.pdfCover(doc, model);

    // --- Página de contenido (sin numeración real para evitar fragilidad) ---
    doc.addPage();
    this.pdfHeader(doc, model, { compact: false });
    this.sectionTitle(doc, 'Contenido', 'Secciones incluidas en este reporte');
    this.bullets(doc, [
      'Resumen ejecutivo',
      'Indicadores clave (KPIs)',
      'Comparación vs. periodo anterior',
      'Insights y recomendaciones',
      'Top conceptos de gasto',
      'Serie mensual (tendencia)',
      model.movimientos?.length ? 'Movimientos (muestra / exportación)' : 'Movimientos (no incluidos)',
      'Notas y definiciones',
    ]);
    doc.moveDown(0.6);

    // --- Resumen ejecutivo ---
    doc.addPage();
    this.pdfHeader(doc, model, { compact: true });
    this.sectionTitle(doc, 'Resumen ejecutivo', 'Panorama general del periodo seleccionado');

    const tot = model.resumen?.totales ?? {};
    const ingresosStr = this.fmtMoney(tot.ingresos, model.moneda);
    const gastosStr = this.fmtMoney(tot.gastos, model.moneda);
    const balanceStr = this.fmtMoney(tot.balance, model.moneda);
    const movsStr = this.fmtInt(tot.movimientos);

    const highlight = [
      { label: 'Ingresos', value: ingresosStr, tone: 'info' as const },
      { label: 'Gastos', value: gastosStr, tone: 'warn' as const },
      { label: 'Balance neto', value: balanceStr, tone: 'good' as const },
      { label: 'Movimientos', value: movsStr, tone: 'neutral' as const },
    ];

    this.kpiCards(doc, highlight);

    doc.moveDown(0.5);
    const paragraph =
      `Durante el periodo ${toIsoDateOnly(new Date(model.periodo.fechaInicio))} a ${toIsoDateOnly(
        new Date(model.periodo.fechaFin),
      )} (${model.periodo.descripcion}), ` +
      `tu actividad financiera registró **${movsStr}** movimientos. ` +
      `Los ingresos fueron **${ingresosStr}**, los gastos **${gastosStr}** y el balance neto **${balanceStr}**.`;
    this.richParagraph(doc, paragraph);

    // --- Comparación ---
    doc.moveDown(0.8);
    this.sectionTitle(doc, 'Comparación vs. periodo anterior', 'Variaciones absolutas y porcentuales');

    const cambios = model.comparacion?.cambios ?? null;
    if (!cambios) {
      this.callout(doc, 'No disponible', 'No se pudo calcular la comparación del periodo anterior.', 'neutral');
    } else {
      const rows = [
        { kpi: 'Ingresos', v: this.formatCambioPremium(cambios.ingresos) },
        { kpi: 'Gastos', v: this.formatCambioPremium(cambios.gastos) },
        { kpi: 'Balance', v: this.formatCambioPremium(cambios.balance) },
        { kpi: 'Movimientos', v: this.formatCambioPremium(cambios.movimientos, { isCount: true }) },
      ];
      this.kvTable(doc, rows, { col1: 170, col2: 320 });
    }

    // --- Insights ---
    doc.addPage();
    this.pdfHeader(doc, model, { compact: true });
    this.sectionTitle(doc, 'Insights', 'Hallazgos y acciones sugeridas');

    const insights = Array.isArray(model.resumen?.insights) ? model.resumen.insights : [];
    if (!insights.length) {
      this.callout(doc, 'Sin insights', 'No hay insights generados para este periodo.', 'neutral');
    } else {
      for (const ins of insights.slice(0, 14)) {
        this.insightCard(doc, ins);
        if (doc.y > 720) doc.addPage(), this.pdfHeader(doc, model, { compact: true });
      }
    }

    // --- Top conceptos ---
    doc.addPage();
    this.pdfHeader(doc, model, { compact: true });
    this.sectionTitle(doc, 'Top conceptos de gasto', 'Dónde se concentró el gasto');

    const top = Array.isArray(model.resumen?.topConceptosGasto) ? model.resumen.topConceptosGasto : [];
    if (!top.length) {
      this.callout(doc, 'Sin datos', 'No hay conceptos de gasto para el periodo.', 'neutral');
    } else {
      const maxTotal = this.maxNumber(top.map((x: any) => x.total));
      const cols: TableColumn<any>[] = [
        { label: 'Concepto', width: 230, align: 'left', value: (r) => String(r.concepto ?? '') },
        {
          label: 'Total',
          width: 120,
          align: 'right',
          value: (r) => this.fmtMoney(r.total, model.moneda),
        },
        {
          label: '%',
          width: 60,
          align: 'right',
          value: (r) => this.fmtPct(r.porcentaje),
        },
      ];

      // tabla + barras de progreso visuales
      this.table(doc, cols, top.slice(0, 14), {
        zebra: true,
        rowHeight: 20,
        afterRow: (row, yTop, rowH, colX) => {
          // mini bar (en la columna Total)
          const total = this.asNumber(row.total) ?? 0;
          const pct = maxTotal > 0 ? total / maxTotal : 0;
          const barW = 86;
          const barX = colX[1] + 8; // dentro de "Total"
          const barY = yTop + rowH - 7;
          doc.save();
          doc.lineWidth(1).strokeColor(this.THEME.palette.subtle);
          doc.rect(barX, barY, barW, 4).stroke();
          doc.fillColor(this.THEME.palette.gold);
          doc.rect(barX, barY, Math.max(0, Math.min(barW, barW * pct)), 4).fill();
          doc.restore();
        },
      });
    }

    // --- Serie mensual ---
    doc.moveDown(0.9);
    this.sectionTitle(doc, 'Serie mensual', 'Tendencia por mes (ingresos, gastos, balance)');

    const serie = Array.isArray(model.resumen?.serieMensual) ? model.resumen.serieMensual : [];
    if (!serie.length) {
      this.callout(doc, 'Sin datos', 'No hay serie mensual disponible para el periodo.', 'neutral');
    } else {
      const cols: TableColumn<any>[] = [
        { label: 'Mes', width: 80, align: 'left', value: (r) => String(r.mes ?? '') },
        { label: 'Ingresos', width: 120, align: 'right', value: (r) => this.fmtMoney(r.ingresos, model.moneda) },
        { label: 'Gastos', width: 120, align: 'right', value: (r) => this.fmtMoney(r.gastos, model.moneda) },
        { label: 'Balance', width: 120, align: 'right', value: (r) => this.fmtMoney(r.balance, model.moneda) },
      ];

      // tabla
      this.table(doc, cols, serie.slice(0, 18), { zebra: true, rowHeight: 20 });

      // mini sparkline (balance)
      doc.moveDown(0.5);
      const balances = serie.slice(0, 24).map((s: any) => this.asNumber(s.balance) ?? 0);
      this.sparkline(doc, balances, { height: 56, label: 'Balance (tendencia)', color: this.THEME.palette.blue });
    }

    // --- Recurrentes (si existen) ---
    const rec = Array.isArray(model.resumen?.recurrentes) ? model.resumen.recurrentes : [];
    if (rec.length) {
      doc.addPage();
      this.pdfHeader(doc, model, { compact: true });
      this.sectionTitle(doc, 'Recurrentes', 'Cargos repetitivos detectados en el periodo');

      const cols: TableColumn<any>[] = [
        { label: 'Recurrente', width: 250, align: 'left', value: (r) => String(r.nombre ?? '') },
        { label: 'Total', width: 120, align: 'right', value: (r) => this.fmtMoney(r.total, model.moneda) },
        { label: '%', width: 60, align: 'right', value: (r) => this.fmtPct(r.porcentaje) },
        { label: 'Cargos', width: 60, align: 'right', value: (r) => this.fmtInt(r.cargos) },
      ];
      this.table(doc, cols, rec.slice(0, 18), { zebra: true, rowHeight: 20 });
    }

    // --- Movimientos (tabla premium) ---
    if (model.movimientos?.length) {
      doc.addPage();
      this.pdfHeader(doc, model, { compact: true });
      this.sectionTitle(doc, 'Movimientos', 'Detalle (muestra) de movimientos más recientes');

      const rows = model.movimientos.slice(0, 800);

      const cols: TableColumn<any>[] = [
        {
          label: 'Fecha',
          width: 72,
          align: 'left',
          value: (m) => (m.fecha ? toIsoDateOnly(new Date(m.fecha)) : ''),
        },
        {
          label: 'Tipo',
          width: 54,
          align: 'center',
          value: (m) => String(m.tipo ?? ''),
        },
        {
          label: 'Concepto',
          width: 130,
          align: 'left',
          value: (m) => String(m.concepto?.nombre ?? ''),
        },
        {
          label: 'Descripción',
          width: 182,
          align: 'left',
          value: (m) => this.trunc(String(m.descripcion ?? ''), 70),
        },
        {
          label: 'Monto',
          width: 88,
          align: 'right',
          value: (m) => `${this.fmtMoney(m.monto, m.moneda ?? model.moneda)}`,
        },
      ];

      this.table(doc, cols, rows, {
        zebra: true,
        rowHeight: 18,
        headerRepeat: true,
        rowStyle: (m) => {
          // color por tipo
          const tipo = String(m.tipo ?? '').toLowerCase();
          if (tipo.includes('ing')) return { text: this.THEME.palette.green };
          if (tipo.includes('gas') || tipo.includes('egr')) return { text: this.THEME.palette.red };
          return { text: this.THEME.palette.ink };
        },
      });

      const totalElementos = model.movimientosMeta?.totalElementos ?? rows.length;
      if (totalElementos > rows.length) {
        doc.moveDown(0.6);
        this.callout(
          doc,
          'Nota',
          `Este PDF incluye una muestra de ${rows.length} movimientos (de ${totalElementos}). ` +
            `Para exportación completa, usa Excel o incrementa limiteMovimientos.`,
          'neutral',
        );
      }
    }

    // --- Notas y definiciones ---
    doc.addPage();
    this.pdfHeader(doc, model, { compact: true });
    this.sectionTitle(doc, 'Notas y definiciones', 'Consideraciones para interpretar este reporte');

    this.bullets(doc, [
      'Los montos se presentan en moneda base o en la moneda de cada movimiento, según corresponda.',
      'La comparación de periodos depende de la disponibilidad del periodo anterior equivalente.',
      'Los insights se generan a partir de patrones detectados en tu actividad y pueden variar según tus datos.',
      'Si exportas a Excel, encontrarás mayor detalle, filtros y hojas auxiliares para análisis.',
    ]);

    // --- Footer con numeración (y marca premium) ---
    this.addPdfFooters(doc, model);

    doc.end();
    return endPromise;
  }

  // ===== PDF helpers (premium) =====

  private pdfCover(doc: PDFKit.PDFDocument, model: any) {
    const { navy, navy2, gold, paper, muted } = this.THEME.palette;

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const M = this.THEME.pdf.margin;

    // fondo superior
    doc.save();
    doc.rect(0, 0, pageW, 220).fill(navy);
    doc.rect(0, 220, pageW, 12).fill(navy2);
    doc.restore();

    // “badge” dorado
    doc.save();
    doc.fillColor(gold);
    doc.roundedRect(M, 34, 92, 22, 6).fill();
    doc.fillColor(navy);
    doc.font(this.THEME.pdf.font.bold).fontSize(10).text('PREMIUM', M, 40, { width: 92, align: 'center' });
    doc.restore();

    doc.fillColor(paper);
    doc.font(this.THEME.pdf.font.bold).fontSize(28).text(this.THEME.brand, M, 78);
    doc.font(this.THEME.pdf.font.bold).fontSize(20).text(model.title, M, 112);

    doc.font(this.THEME.pdf.font.regular).fontSize(11).fillColor('#D6E1FF');
    doc.text('Reporte detallado con KPIs, tendencias, insights y exportación', M, 146);

    // tarjeta de datos
    const cardX = M;
    const cardY = 262;
    const cardW = pageW - M * 2;
    const cardH = 150;

    doc.save();
    doc.fillColor(this.THEME.palette.bgSoft);
    doc.roundedRect(cardX, cardY, cardW, cardH, 14).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
    doc.roundedRect(cardX, cardY, cardW, cardH, 14).stroke();
    doc.restore();

    const leftX = cardX + 18;
    let y = cardY + 16;

    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(12).text('Datos del reporte', leftX, y);
    y += 20;

    doc.font(this.THEME.pdf.font.regular).fontSize(10).fillColor(muted);
    doc.text(`Generado: ${new Date(model.generatedAt).toISOString()}`, leftX, y);
    y += 14;
    doc.text(`Usuario: ${model.user.nombre}${model.user.email ? ` (${model.user.email})` : ''}`, leftX, y);
    y += 14;
    doc.text(
      `Periodo: ${toIsoDateOnly(new Date(model.periodo.fechaInicio))} a ${toIsoDateOnly(new Date(model.periodo.fechaFin))}`,
      leftX,
      y,
    );
    y += 14;
    doc.text(`Descripción: ${model.periodo.descripcion}`, leftX, y, { width: cardW - 36 });
    y += 14;
    doc.text(`Moneda base: ${model.moneda}`, leftX, y);

    // KPIs mini
    const tot = model.resumen?.totales ?? {};
    const kpis = [
      { label: 'Ingresos', value: this.fmtMoney(tot.ingresos, model.moneda), color: this.THEME.palette.blue },
      { label: 'Gastos', value: this.fmtMoney(tot.gastos, model.moneda), color: this.THEME.palette.red },
      { label: 'Balance', value: this.fmtMoney(tot.balance, model.moneda), color: this.THEME.palette.green },
      { label: 'Movs', value: this.fmtInt(tot.movimientos), color: this.THEME.palette.purple },
    ];

    const boxY = cardY + cardH + 18;
    const gap = 10;
    const boxW = (cardW - gap * 3) / 4;
    const boxH = 72;

    for (let i = 0; i < kpis.length; i++) {
      const x = cardX + i * (boxW + gap);
      this.kpiMini(doc, x, boxY, boxW, boxH, kpis[i].label, kpis[i].value, kpis[i].color);
    }

    // footer portada
    doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9);
    doc.text('Confidencial • Uso personal • LitFinance', M, pageH - 56, { width: pageW - M * 2, align: 'left' });
  }

  private pdfHeader(doc: PDFKit.PDFDocument, model: any, opts: { compact: boolean }) {
    const M = this.THEME.pdf.margin;
    const topY = M - 10;

    doc.save();
    doc.fillColor(this.THEME.palette.ink);
    doc.font(this.THEME.pdf.font.bold).fontSize(opts.compact ? 12 : 14).text(this.THEME.brand, M, topY, {
      continued: true,
    });
    doc.font(this.THEME.pdf.font.regular).fillColor(this.THEME.palette.muted).fontSize(10).text(`  •  ${model.title}`);
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
    doc.moveTo(M, M + 12).lineTo(doc.page.width - M, M + 12).stroke();
    doc.restore();

    doc.moveDown(1.2);
  }

  private addPdfFooters(doc: PDFKit.PDFDocument, model: any) {
    const range = doc.bufferedPageRange(); // { start, count }
    const M = this.THEME.pdf.margin;

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const pageNum = i - range.start + 1;

      const y = doc.page.height - 34;

      doc.save();
      doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
      doc.moveTo(M, y - 10).lineTo(doc.page.width - M, y - 10).stroke();

      doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9);
      doc.text(
        `${this.THEME.brand} • ${toIsoDateOnly(new Date(model.periodo.fechaInicio))} → ${toIsoDateOnly(
          new Date(model.periodo.fechaFin),
        )}`,
        M,
        y,
        { align: 'left', width: doc.page.width - M * 2 },
      );

      doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9);
      doc.text(`Página ${pageNum} de ${range.count}`, M, y, { align: 'right', width: doc.page.width - M * 2 });

      doc.restore();
    }
  }

  private sectionTitle(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(16).text(title);
    if (subtitle) {
      doc.moveDown(0.25);
      doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(10).text(subtitle);
    }
    doc.moveDown(0.65);
  }

  private bullets(doc: PDFKit.PDFDocument, items: string[]) {
    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.regular).fontSize(11);
    for (const it of items) {
      doc.text(`• ${it}`, { indent: 10 });
    }
    doc.moveDown(0.4);
  }

  private callout(
    doc: PDFKit.PDFDocument,
    title: string,
    body: string,
    tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info',
  ) {
    const M = this.THEME.pdf.margin;
    const w = doc.page.width - M * 2;

    const tones: Record<string, { bg: string; border: string; title: string }> = {
      good: { bg: '#ECFDF5', border: this.THEME.palette.green, title: this.THEME.palette.green },
      warn: { bg: '#FFFBEB', border: this.THEME.palette.gold, title: this.THEME.palette.gold },
      bad: { bg: '#FEF2F2', border: this.THEME.palette.red, title: this.THEME.palette.red },
      info: { bg: '#EFF6FF', border: this.THEME.palette.blue, title: this.THEME.palette.blue },
      neutral: { bg: this.THEME.palette.bgSoft, border: this.THEME.palette.subtle, title: this.THEME.palette.ink },
    };

    const t = tones[tone];
    const x = M;
    const y = doc.y;
    const pad = 12;
    const h = 54;

    doc.save();
    doc.fillColor(t.bg).roundedRect(x, y, w, h, 12).fill();
    doc.strokeColor(t.border).lineWidth(1).roundedRect(x, y, w, h, 12).stroke();

    doc.fillColor(t.title).font(this.THEME.pdf.font.bold).fontSize(11).text(title, x + pad, y + 10);
    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.regular).fontSize(10).text(body, x + pad, y + 26, {
      width: w - pad * 2,
    });

    doc.restore();
    doc.moveDown(3.2);
  }

  private richParagraph(doc: PDFKit.PDFDocument, text: string) {
    // pdfkit no soporta markdown “real”, pero podemos simular énfasis mínimo
    // reemplazando **bold** por split segments.
    const parts = text.split('**');
    doc.fillColor(this.THEME.palette.ink).fontSize(11);

    for (let i = 0; i < parts.length; i++) {
      const isBold = i % 2 === 1;
      doc.font(isBold ? this.THEME.pdf.font.bold : this.THEME.pdf.font.regular);
      doc.text(parts[i], { continued: i !== parts.length - 1 });
    }
    doc.text('', { continued: false });
  }

  private kpiMini(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    accent: string,
  ) {
    doc.save();
    doc.fillColor(this.THEME.palette.paper);
    doc.roundedRect(x, y, w, h, 14).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1).roundedRect(x, y, w, h, 14).stroke();
    doc.fillColor(accent).rect(x, y, 6, h).fill();

    doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9).text(label, x + 12, y + 12, {
      width: w - 18,
    });
    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(12).text(value, x + 12, y + 30, {
      width: w - 18,
    });
    doc.restore();
  }

  private kpiCards(
    doc: PDFKit.PDFDocument,
    items: { label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info' }[],
  ) {
    const M = this.THEME.pdf.margin;
    const w = doc.page.width - M * 2;
    const gap = 10;
    const cardW = (w - gap * 3) / 4;
    const cardH = 78;

    const tones: Record<string, { bg: string; border: string; accent: string }> = {
      good: { bg: '#ECFDF5', border: '#BBF7D0', accent: this.THEME.palette.green },
      warn: { bg: '#FFFBEB', border: '#FDE68A', accent: this.THEME.palette.gold },
      bad: { bg: '#FEF2F2', border: '#FECACA', accent: this.THEME.palette.red },
      info: { bg: '#EFF6FF', border: '#BFDBFE', accent: this.THEME.palette.blue },
      neutral: { bg: this.THEME.palette.bgSoft, border: this.THEME.palette.subtle, accent: this.THEME.palette.ink },
    };

    const startY = doc.y;
    for (let i = 0; i < items.length; i++) {
      const x = M + i * (cardW + gap);
      const t = tones[items[i].tone];

      doc.save();
      doc.fillColor(t.bg).roundedRect(x, startY, cardW, cardH, 14).fill();
      doc.strokeColor(t.border).lineWidth(1).roundedRect(x, startY, cardW, cardH, 14).stroke();
      doc.fillColor(t.accent).rect(x, startY, 6, cardH).fill();

      doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9).text(items[i].label, x + 12, startY + 12, {
        width: cardW - 20,
      });
      doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(12).text(items[i].value, x + 12, startY + 30, {
        width: cardW - 20,
      });

      doc.restore();
    }

    doc.y = startY + cardH + 16;
  }

  private kvTable(doc: PDFKit.PDFDocument, rows: { kpi: string; v: { text: string; color: string } }[], opts: { col1: number; col2: number }) {
    const M = this.THEME.pdf.margin;
    const x = M;
    let y = doc.y;

    const w = opts.col1 + opts.col2;
    doc.save();
    doc.fillColor(this.THEME.palette.bgSoft).roundedRect(x, y, w, 14 + rows.length * 18, 12).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1).roundedRect(x, y, w, 14 + rows.length * 18, 12).stroke();
    doc.restore();

    y += 10;
    for (const r of rows) {
      doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(10).text(r.kpi, x + 12, y, { width: opts.col1 - 18 });
      doc.fillColor(r.v.color).font(this.THEME.pdf.font.bold).fontSize(10).text(r.v.text, x + opts.col1, y, {
        width: opts.col2 - 12,
        align: 'right',
      });
      y += 18;
    }
    doc.y = y + 10;
  }

  private insightCard(doc: PDFKit.PDFDocument, ins: any) {
    const M = this.THEME.pdf.margin;
    const w = doc.page.width - M * 2;
    const x = M;
    const y = doc.y;

    const prioridad = String(ins?.prioridad ?? '').toUpperCase();
    const title = String(ins?.titulo ?? 'Insight');
    const desc = String(ins?.descripcion ?? '');
    const accion = String(ins?.accionSugerida ?? '');

    const tone =
      prioridad.includes('ALTA') || prioridad.includes('HIGH') ? 'bad'
      : prioridad.includes('MEDIA') || prioridad.includes('MED') ? 'warn'
      : prioridad ? 'info'
      : 'neutral';

    const toneStyles: Record<string, { border: string; badgeBg: string; badgeText: string }> = {
      bad: { border: this.THEME.palette.red, badgeBg: '#FEE2E2', badgeText: this.THEME.palette.red },
      warn: { border: this.THEME.palette.gold, badgeBg: '#FEF3C7', badgeText: this.THEME.palette.gold },
      info: { border: this.THEME.palette.blue, badgeBg: '#DBEAFE', badgeText: this.THEME.palette.blue },
      neutral: { border: this.THEME.palette.subtle, badgeBg: this.THEME.palette.bgSoft, badgeText: this.THEME.palette.ink },
    };

    const t = toneStyles[tone];

    const h = 86;
    doc.save();
    doc.fillColor(this.THEME.palette.paper).roundedRect(x, y, w, h, 14).fill();
    doc.strokeColor(t.border).lineWidth(1).roundedRect(x, y, w, h, 14).stroke();

    // badge
    const badgeW = 78;
    doc.fillColor(t.badgeBg).roundedRect(x + 12, y + 12, badgeW, 20, 10).fill();
    doc.fillColor(t.badgeText).font(this.THEME.pdf.font.bold).fontSize(9).text(prioridad || 'INFO', x + 12, y + 17, { width: badgeW, align: 'center' });

    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(12).text(title, x + 12 + badgeW + 10, y + 12, {
      width: w - (12 + badgeW + 10) - 12,
    });

    doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(10).text(this.trunc(desc, 180), x + 12, y + 36, {
      width: w - 24,
    });

    if (accion) {
      doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(10).text('Acción sugerida:', x + 12, y + 58);
      doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(10).text(this.trunc(accion, 160), x + 104, y + 58, {
        width: w - 116,
      });
    }

    doc.restore();
    doc.y = y + h + 12;
  }

  private table<T>(
    doc: PDFKit.PDFDocument,
    cols: TableColumn<T>[],
    rows: T[],
    opts?: {
      zebra?: boolean;
      rowHeight?: number;
      headerRepeat?: boolean;
      afterRow?: (row: T, yTop: number, rowH: number, colX: number[]) => void;
      rowStyle?: (row: T) => { text?: string };
    },
  ) {
    const M = this.THEME.pdf.margin;
    const pageW = doc.page.width;
    const usableW = pageW - M * 2;

    // recalcular widths si no suman al usableW
    const sumW = cols.reduce((a, c) => a + c.width, 0);
    if (Math.abs(sumW - usableW) > 2) {
      // ajuste proporcional (mantiene ratio)
      const scale = usableW / sumW;
      cols = cols.map((c) => ({ ...c, width: Math.max(40, Math.floor(c.width * scale)) }));
    }

    const rowH = opts?.rowHeight ?? 20;
    const x0 = M;
    const colX: number[] = [];
    let acc = x0;
    for (const c of cols) {
      colX.push(acc);
      acc += c.width;
    }

    const drawHeader = () => {
      const y = doc.y;
      doc.save();
      doc.fillColor(this.THEME.palette.navy).roundedRect(x0, y, usableW, rowH + 2, 10).fill();
      doc.fillColor('#FFFFFF').font(this.THEME.pdf.font.bold).fontSize(10);

      for (let i = 0; i < cols.length; i++) {
        doc.text(cols[i].label, colX[i] + 8, y + 6, { width: cols[i].width - 16, align: cols[i].align ?? 'left' });
      }
      doc.restore();
      doc.y = y + rowH + 8;
    };

    drawHeader();

    let idx = 0;
    for (const r of rows) {
      // salto de página
      if (doc.y + rowH + 34 > doc.page.height) {
        doc.addPage();
        // use model passed via opts.model if available, otherwise fall back to a minimal object
        const headerModel = (opts as any)?.model ?? { title: 'Reporte' };
        this.pdfHeader(doc, { ...headerModel, title: headerModel?.title ?? 'Reporte' } as any, { compact: true });
        if (opts?.headerRepeat !== false) drawHeader();
      }

      const yTop = doc.y;
      const zebra = !!opts?.zebra && idx % 2 === 1;

      // row bg
      if (zebra) {
        doc.save();
        doc.fillColor(this.THEME.palette.rowAlt);
        doc.rect(x0, yTop - 2, usableW, rowH + 4).fill();
        doc.restore();
      }

      // row border
      doc.save();
      doc.strokeColor(this.THEME.palette.subtle).lineWidth(0.6);
      doc.moveTo(x0, yTop + rowH + 2).lineTo(x0 + usableW, yTop + rowH + 2).stroke();
      doc.restore();

      const style = opts?.rowStyle?.(r) ?? {};
      doc.fillColor(style.text ?? this.THEME.palette.ink).font(this.THEME.pdf.font.regular).fontSize(9.5);

      for (let i = 0; i < cols.length; i++) {
        const txt = cols[i].value(r);
        doc.text(txt, colX[i] + 8, yTop + 5, {
          width: cols[i].width - 16,
          align: cols[i].align ?? 'left',
          lineBreak: false,
          ellipsis: true,
        });
      }

      opts?.afterRow?.(r, yTop, rowH, colX);
      doc.y = yTop + rowH + 6;

      idx++;
    }

    doc.moveDown(0.5);
  }

  private sparkline(doc: PDFKit.PDFDocument, values: number[], opts: { height: number; label: string; color: string }) {
    const M = this.THEME.pdf.margin;
    const w = doc.page.width - M * 2;
    const h = opts.height;
    const x = M;
    const y = doc.y;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    // panel
    doc.save();
    doc.fillColor(this.THEME.palette.bgSoft).roundedRect(x, y, w, h + 28, 14).fill();
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1).roundedRect(x, y, w, h + 28, 14).stroke();

    doc.fillColor(this.THEME.palette.ink).font(this.THEME.pdf.font.bold).fontSize(11).text(opts.label, x + 14, y + 10);

    const chartX = x + 14;
    const chartY = y + 26;
    const chartW = w - 28;
    const chartH = h;

    // axis line
    doc.strokeColor(this.THEME.palette.subtle).lineWidth(1);
    doc.moveTo(chartX, chartY + chartH).lineTo(chartX + chartW, chartY + chartH).stroke();

    // line
    doc.strokeColor(opts.color).lineWidth(2);
    for (let i = 0; i < values.length; i++) {
      const px = chartX + (chartW * i) / Math.max(1, values.length - 1);
      const py = chartY + chartH - ((values[i] - min) / range) * chartH;
      if (i === 0) doc.moveTo(px, py);
      else doc.lineTo(px, py);
    }
    doc.stroke();

    // min/max labels
    doc.fillColor(this.THEME.palette.muted).font(this.THEME.pdf.font.regular).fontSize(9);
    doc.text(`min: ${this.fmtMoney(min, 'MXN').replace('MXN', '').trim()}`, chartX, chartY + chartH + 6, { align: 'left', width: chartW });
    doc.text(`max: ${this.fmtMoney(max, 'MXN').replace('MXN', '').trim()}`, chartX, chartY + chartH + 6, { align: 'right', width: chartW });

    doc.restore();
    doc.y = y + h + 38;
  }

  // =========================
  // XLSX (Premium workbook)
  // =========================
  private async generarXlsx(model: any): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = this.THEME.brand;
    wb.created = model.generatedAt;
    wb.modified = model.generatedAt;

    // propiedades (se ve “pro” al abrir)
    (wb as any).properties = {
      title: `${this.THEME.brand} | ${model.title}`,
      subject: `Reporte ${model.title}`,
      keywords: 'LitFinance, reporte, finanzas, analytics',
      category: 'Finance',
      company: this.THEME.brand,
      manager: this.THEME.brand,
    };

    const currency = model.moneda ?? 'MXN';
    const fmtCurrency = this.excelCurrencyFormat(currency);

    // --- Portada ---
    const wsCover = wb.addWorksheet('Portada', { views: [{ state: 'frozen', ySplit: 0 }] });
    wsCover.properties.tabColor = { argb: this.THEME.excel.accent };

    wsCover.getColumn(1).width = 4;
    wsCover.getColumn(2).width = 36;
    wsCover.getColumn(3).width = 60;

    wsCover.mergeCells('B2:C2');
    wsCover.getCell('B2').value = `${this.THEME.brand} • ${model.title}`;
    wsCover.getCell('B2').font = { bold: true, size: 18, color: { argb: this.THEME.excel.titleFont } };
    wsCover.getCell('B2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.THEME.excel.titleFill } };
    wsCover.getCell('B2').alignment = { vertical: 'middle', horizontal: 'left' };
    wsCover.getRow(2).height = 32;

    const coverMeta = [
      ['Generado', new Date(model.generatedAt).toISOString()],
      ['Usuario', `${model.user.nombre}${model.user.email ? ` (${model.user.email})` : ''}`],
      ['Periodo', `${toIsoDateOnly(new Date(model.periodo.fechaInicio))} a ${toIsoDateOnly(new Date(model.periodo.fechaFin))}`],
      ['Descripción', model.periodo.descripcion],
      ['Moneda base', currency],
    ];

    let r = 4;
    for (const [k, v] of coverMeta) {
      wsCover.getCell(`B${r}`).value = k;
      wsCover.getCell(`C${r}`).value = v;

      wsCover.getCell(`B${r}`).font = { bold: true, color: { argb: '0B1220' } };
      wsCover.getCell(`B${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.THEME.excel.subtleFill } };
      wsCover.getCell(`B${r}`).border = this.excelThinBorder();

      wsCover.getCell(`C${r}`).border = this.excelThinBorder();
      wsCover.getCell(`C${r}`).alignment = { wrapText: true, vertical: 'top' };
      wsCover.getRow(r).height = 18;

      r++;
    }

    // KPIs
    const tot = model.resumen?.totales ?? {};
    const kpiRows = [
      ['Ingresos', this.asNumber(tot.ingresos) ?? tot.ingresos ?? 0],
      ['Gastos', this.asNumber(tot.gastos) ?? tot.gastos ?? 0],
      ['Balance', this.asNumber(tot.balance) ?? tot.balance ?? 0],
      ['Movimientos', this.asNumber(tot.movimientos) ?? tot.movimientos ?? 0],
    ];

    wsCover.mergeCells(`B${r}:C${r}`);
    wsCover.getCell(`B${r}`).value = 'KPIs';
    wsCover.getCell(`B${r}`).font = { bold: true, size: 12, color: { argb: 'FFFFFF' } };
    wsCover.getCell(`B${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: this.THEME.excel.headerFill } };
    wsCover.getRow(r).height = 22;
    r++;

    for (const [k, v] of kpiRows) {
      wsCover.getCell(`B${r}`).value = k;
      wsCover.getCell(`C${r}`).value = v as any;

      wsCover.getCell(`B${r}`).font = { bold: true };
      wsCover.getCell(`B${r}`).border = this.excelThinBorder();
      wsCover.getCell(`C${r}`).border = this.excelThinBorder();

      if (k !== 'Movimientos') {
        wsCover.getCell(`C${r}`).numFmt = fmtCurrency;
      } else {
        wsCover.getCell(`C${r}`).numFmt = '#,##0';
      }

      r++;
    }

    // --- Resumen (Tabla) ---
    const wsResumen = wb.addWorksheet('Resumen', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsResumen.properties.tabColor = { argb: this.THEME.excel.info };

    const resumenRows: Array<[string, any]> = [
      ['Generado', new Date(model.generatedAt).toISOString()],
      ['Usuario', `${model.user.nombre}${model.user.email ? ` (${model.user.email})` : ''}`],
      ['Periodo', `${toIsoDateOnly(new Date(model.periodo.fechaInicio))} a ${toIsoDateOnly(new Date(model.periodo.fechaFin))}`],
      ['Descripción', model.periodo.descripcion],
      ['Moneda base', currency],
      ['Ingresos', this.asNumber(tot.ingresos) ?? tot.ingresos ?? 0],
      ['Gastos', this.asNumber(tot.gastos) ?? tot.gastos ?? 0],
      ['Balance', this.asNumber(tot.balance) ?? tot.balance ?? 0],
      ['Movimientos', this.asNumber(tot.movimientos) ?? tot.movimientos ?? 0],
    ];

    // comparación (si existe)
    const cambios = model.comparacion?.cambios;
    if (cambios) {
      resumenRows.push(['Δ Ingresos (abs)', this.asNumber(cambios.ingresos?.absoluto) ?? cambios.ingresos?.absoluto ?? '']);
      resumenRows.push(['Δ Ingresos (%)', this.asNumber(cambios.ingresos?.porcentual) ?? cambios.ingresos?.porcentual ?? '']);
      resumenRows.push(['Δ Gastos (abs)', this.asNumber(cambios.gastos?.absoluto) ?? cambios.gastos?.absoluto ?? '']);
      resumenRows.push(['Δ Gastos (%)', this.asNumber(cambios.gastos?.porcentual) ?? cambios.gastos?.porcentual ?? '']);
      resumenRows.push(['Δ Balance (abs)', this.asNumber(cambios.balance?.absoluto) ?? cambios.balance?.absoluto ?? '']);
      resumenRows.push(['Δ Balance (%)', this.asNumber(cambios.balance?.porcentual) ?? cambios.balance?.porcentual ?? '']);
      resumenRows.push(['Δ Movimientos (abs)', this.asNumber(cambios.movimientos?.absoluto) ?? cambios.movimientos?.absoluto ?? '']);
      resumenRows.push(['Δ Movimientos (%)', this.asNumber(cambios.movimientos?.porcentual) ?? cambios.movimientos?.porcentual ?? '']);
    }

    wsResumen.getColumn(1).width = 30;
    wsResumen.getColumn(2).width = 72;

    wsResumen.getRow(1).values = ['Campo', 'Valor'];
    this.excelHeaderRow(wsResumen.getRow(1));

    for (const rr of resumenRows) {
      const row = wsResumen.addRow(rr);
      row.getCell(1).border = this.excelThinBorder();
      row.getCell(2).border = this.excelThinBorder();
      row.getCell(1).font = { bold: true };

      const label = String(rr[0]);
      if (['Ingresos', 'Gastos', 'Balance', 'Δ Ingresos (abs)', 'Δ Gastos (abs)', 'Δ Balance (abs)'].includes(label)) {
        row.getCell(2).numFmt = fmtCurrency;
      }
      if (label.includes('(%)')) {
        row.getCell(2).numFmt = '0.0"%"';
      }
      if (label === 'Movimientos' || label.includes('Movimientos (abs)')) {
        row.getCell(2).numFmt = '#,##0';
      }
    }

    // autoFilter
    wsResumen.autoFilter = { from: 'A1', to: 'B1' };

    // --- Insights ---
    const wsInsights = wb.addWorksheet('Insights', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsInsights.properties.tabColor = { argb: '7C3AED' };
    wsInsights.columns = [
      { header: 'Prioridad', key: 'prioridad', width: 14 },
      { header: 'Título', key: 'titulo', width: 34 },
      { header: 'Descripción', key: 'desc', width: 80 },
      { header: 'Acción sugerida', key: 'accion', width: 44 },
    ];
    this.excelHeaderRow(wsInsights.getRow(1));
    wsInsights.autoFilter = { from: 'A1', to: 'D1' };

    for (const ins of model.resumen?.insights ?? []) {
      const row = wsInsights.addRow({
        prioridad: ins.prioridad ?? '',
        titulo: ins.titulo ?? '',
        desc: ins.descripcion ?? '',
        accion: ins.accionSugerida ?? '',
      });

      // borders
      for (let i = 1; i <= 4; i++) row.getCell(i).border = this.excelThinBorder();
      row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
      row.height = 34;

      // “priority badge” look (fill en prioridad)
      const p = String(ins.prioridad ?? '').toLowerCase();
      if (p.includes('alta') || p.includes('high')) {
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } };
        row.getCell(1).font = { bold: true, color: { argb: this.THEME.excel.bad } };
      } else if (p.includes('media') || p.includes('med')) {
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } };
        row.getCell(1).font = { bold: true, color: { argb: this.THEME.excel.accent } };
      } else if (p) {
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DBEAFE' } };
        row.getCell(1).font = { bold: true, color: { argb: this.THEME.excel.info } };
      }
    }

    // --- Serie mensual (con tabla estilo) ---
    const wsSerie = wb.addWorksheet('SerieMensual', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsSerie.properties.tabColor = { argb: '0D9488' };
    const serie = model.resumen?.serieMensual ?? [];

    wsSerie.columns = [
      { header: 'Mes', key: 'mes', width: 14 },
      { header: 'Ingresos', key: 'ing', width: 16 },
      { header: 'Gastos', key: 'gas', width: 16 },
      { header: 'Balance', key: 'bal', width: 16 },
      { header: 'Movimientos', key: 'mov', width: 14 },
    ];
    this.excelHeaderRow(wsSerie.getRow(1));
    wsSerie.autoFilter = { from: 'A1', to: 'E1' };

    for (const s of serie) {
      const row = wsSerie.addRow({
        mes: s.mes,
        ing: this.asNumber(s.ingresos) ?? s.ingresos ?? 0,
        gas: this.asNumber(s.gastos) ?? s.gastos ?? 0,
        bal: this.asNumber(s.balance) ?? s.balance ?? 0,
        mov: this.asNumber(s.movimientos) ?? s.movimientos ?? 0,
      });

      for (let i = 1; i <= 5; i++) row.getCell(i).border = this.excelThinBorder();
      row.getCell(2).numFmt = fmtCurrency;
      row.getCell(3).numFmt = fmtCurrency;
      row.getCell(4).numFmt = fmtCurrency;
      row.getCell(5).numFmt = '#,##0';
    }

    // --- Top conceptos ---
    const wsTop = wb.addWorksheet('TopConceptosGasto', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsTop.properties.tabColor = { argb: this.THEME.excel.accent };
    wsTop.columns = [
      { header: 'Concepto', key: 'concepto', width: 38 },
      { header: 'Total', key: 'total', width: 18 },
      { header: 'Porcentaje', key: 'pct', width: 14 },
      { header: 'Movimientos', key: 'mov', width: 14 },
    ];
    this.excelHeaderRow(wsTop.getRow(1));
    wsTop.autoFilter = { from: 'A1', to: 'D1' };

    for (const t of model.resumen?.topConceptosGasto ?? []) {
      const row = wsTop.addRow({
        concepto: t.concepto ?? '',
        total: this.asNumber(t.total) ?? t.total ?? 0,
        pct: this.asNumber(t.porcentaje) ?? t.porcentaje ?? 0,
        mov: this.asNumber(t.movimientos) ?? t.movimientos ?? 0,
      });
      for (let i = 1; i <= 4; i++) row.getCell(i).border = this.excelThinBorder();
      row.getCell(2).numFmt = fmtCurrency;
      row.getCell(3).numFmt = '0.0"%"';
      row.getCell(4).numFmt = '#,##0';
    }

    // --- Recurrentes ---
    const wsRec = wb.addWorksheet('Recurrentes', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsRec.properties.tabColor = { argb: '7C3AED' };
    wsRec.columns = [
      { header: 'Recurrente', key: 'nombre', width: 38 },
      { header: 'Total', key: 'total', width: 18 },
      { header: 'Porcentaje', key: 'pct', width: 14 },
      { header: 'Cargos', key: 'cargos', width: 14 },
    ];
    this.excelHeaderRow(wsRec.getRow(1));
    wsRec.autoFilter = { from: 'A1', to: 'D1' };

    for (const rrr of model.resumen?.recurrentes ?? []) {
      const row = wsRec.addRow({
        nombre: rrr.nombre ?? '',
        total: this.asNumber(rrr.total) ?? rrr.total ?? 0,
        pct: this.asNumber(rrr.porcentaje) ?? rrr.porcentaje ?? 0,
        cargos: this.asNumber(rrr.cargos) ?? rrr.cargos ?? 0,
      });
      for (let i = 1; i <= 4; i++) row.getCell(i).border = this.excelThinBorder();
      row.getCell(2).numFmt = fmtCurrency;
      row.getCell(3).numFmt = '0.0"%"';
      row.getCell(4).numFmt = '#,##0';
    }

    // --- Movimientos (premium table, zebra, filtros, numFmt) ---
    if (model.movimientos?.length) {
      const wsMov = wb.addWorksheet('Movimientos', { views: [{ state: 'frozen', ySplit: 1 }] });
      wsMov.properties.tabColor = { argb: '2563EB' };

      wsMov.columns = [
        { header: 'Fecha', key: 'fecha', width: 14 },
        { header: 'Tipo', key: 'tipo', width: 12 },
        { header: 'Concepto', key: 'concepto', width: 28 },
        { header: 'Subcuenta', key: 'subcuenta', width: 22 },
        { header: 'Descripción', key: 'desc', width: 56 },
        { header: 'Monto', key: 'monto', width: 16 },
        { header: 'Moneda', key: 'moneda', width: 10 },
      ];

      this.excelHeaderRow(wsMov.getRow(1));
      wsMov.autoFilter = { from: 'A1', to: 'G1' };

      for (const m of model.movimientos) {
        const row = wsMov.addRow({
          fecha: m.fecha ? toIsoDateOnly(new Date(m.fecha)) : '',
          tipo: m.tipo ?? '',
          concepto: m.concepto?.nombre ?? '',
          subcuenta: m.subcuenta?.nombre ?? '',
          desc: m.descripcion ?? '',
          monto: this.asNumber(m.monto) ?? m.monto ?? 0,
          moneda: m.moneda ?? currency,
        });

        // borders + wrap
        for (let i = 1; i <= 7; i++) row.getCell(i).border = this.excelThinBorder();
        row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
        row.height = 22;

        // number format: monto
        row.getCell(6).numFmt = this.excelCurrencyFormat(row.getCell(7).value as any || currency);

        // color por tipo (ingreso/egreso)
        const tipo = String(m.tipo ?? '').toLowerCase();
        if (tipo.includes('ing')) row.getCell(6).font = { color: { argb: this.THEME.excel.good }, bold: true };
        if (tipo.includes('gas') || tipo.includes('egr')) row.getCell(6).font = { color: { argb: this.THEME.excel.bad }, bold: true };
      }

      // zebra (fill alterno)
      for (let i = 2; i <= wsMov.rowCount; i++) {
        if (i % 2 === 0) {
          wsMov.getRow(i).eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
          });
        }
      }
    }

    // Ajuste final: negritas header ya aplicado; asegurar congelado + estilo
    for (const ws of wb.worksheets) {
      // líneas guía visuales
      ws.views = ws.views?.length ? ws.views : [{ state: 'frozen', ySplit: 1 }];

      // set alignment default en header
      const r1 = ws.getRow(1);
      r1.alignment = { vertical: 'middle' };

      // safe default
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell((cell) => {
          if (!cell.alignment) cell.alignment = { vertical: 'middle' };
        });
      });
    }

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as any);
  }

  // =========================
  // Formatting helpers
  // =========================

  private trunc(s: string, max: number) {
    if (!s) return '';
    return s.length <= max ? s : s.slice(0, max - 1) + '…';
  }

  private asNumber(v: any): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const cleaned = v.replace(/[^0-9.-]+/g, '');
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private fmtMoney(v: any, currency: string): string {
    const n = this.asNumber(v);
    if (n === null) return String(v ?? '');
    try {
      return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: currency || 'MXN',
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${n.toFixed(2)} ${currency || ''}`.trim();
    }
  }

  private fmtInt(v: any): string {
    const n = this.asNumber(v);
    if (n === null) return String(v ?? '');
    return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(n);
  }

  private fmtPct(v: any): string {
    const n = this.asNumber(v);
    if (n === null) return String(v ?? '');
    return `${n.toFixed(1)}%`;
  }

  private maxNumber(values: any[]): number {
    let m = 0;
    for (const v of values) {
      const n = this.asNumber(v);
      if (n !== null) m = Math.max(m, n);
    }
    return m;
  }

  private formatCambioPremium(c: any, opts?: { isCount?: boolean }): { text: string; color: string } {
    const abs = this.asNumber(c?.absoluto ?? 0) ?? 0;
    const pct = this.asNumber(c?.porcentual ?? 0) ?? 0;

    const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '•';
    const color = pct > 0 ? this.THEME.palette.green : pct < 0 ? this.THEME.palette.red : this.THEME.palette.muted;

    const absStr = opts?.isCount ? this.fmtInt(abs) : `${this.fmtInt(abs)}`;
    const pctStr = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : `${pct}%`;

    return { text: `${arrow} ${absStr} (${pctStr})`, color };
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
