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
      mimeType =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
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

  private async generarPdf(model: any): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];

    doc.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));

    const endPromise = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Header
    doc.fontSize(18).text('LitFinance', { continued: true });
    doc.fontSize(18).text('  |  Reporte Financiero', { align: 'left' });
    doc.moveDown(0.5);

    doc
      .fontSize(10)
      .fillColor('#444')
      .text(`Generado: ${model.generatedAt.toISOString()}`)
      .text(`Usuario: ${model.user.nombre}${model.user.email ? ` (${model.user.email})` : ''}`)
      .text(
        `Periodo: ${toIsoDateOnly(new Date(model.periodo.fechaInicio))} a ${toIsoDateOnly(
          new Date(model.periodo.fechaFin),
        )}  |  ${model.periodo.descripcion}`,
      )
      .text(`Moneda base: ${model.moneda}`);

    doc.moveDown(1);
    doc.fillColor('#000').fontSize(14).text('Resumen');

    const tot = model.resumen.totales;
    doc
      .fontSize(11)
      .text(`Ingresos: ${tot.ingresos}`)
      .text(`Gastos: ${tot.gastos}`)
      .text(`Balance: ${tot.balance}`)
      .text(`Movimientos: ${tot.movimientos}`);

    doc.moveDown(0.5);
    doc.fontSize(12).text('Comparación vs período anterior');
    const c = model.comparacion?.cambios;
    if (c) {
      doc
        .fontSize(11)
        .text(`Ingresos: ${this.formatCambio(c.ingresos)}`)
        .text(`Gastos: ${this.formatCambio(c.gastos)}`)
        .text(`Balance: ${this.formatCambio(c.balance)}`)
        .text(`Movimientos: ${this.formatCambio(c.movimientos)}`);
    } else {
      doc.fontSize(11).text('No disponible');
    }

    doc.moveDown(0.75);
    doc.fontSize(14).text('Insights');
    const insights = model.resumen.insights ?? [];
    if (!insights.length) {
      doc.fontSize(11).text('Sin insights para este periodo.');
    } else {
      doc.fontSize(11);
      for (const ins of insights.slice(0, 12)) {
        doc.text(`- ${ins.titulo}: ${ins.descripcion}`);
      }
    }

    doc.moveDown(0.75);
    doc.fontSize(14).text('Top conceptos de gasto');
    const top = model.resumen.topConceptosGasto ?? [];
    if (!top.length) {
      doc.fontSize(11).text('Sin datos.');
    } else {
      for (const item of top.slice(0, 12)) {
        doc.fontSize(11).text(`- ${item.concepto}: ${item.total} (${item.porcentaje?.toFixed?.(1) ?? item.porcentaje}%)`);
      }
    }

    doc.moveDown(0.75);
    doc.fontSize(14).text('Serie mensual');
    const serie = model.resumen.serieMensual ?? [];
    if (!serie.length) {
      doc.fontSize(11).text('Sin datos.');
    } else {
      for (const row of serie.slice(0, 24)) {
        doc
          .fontSize(11)
          .text(`${row.mes}: ingresos ${row.ingresos} | gastos ${row.gastos} | balance ${row.balance}`);
      }
    }

    if (model.movimientos?.length) {
      doc.addPage();
      doc.fontSize(14).text('Movimientos (muestra)');
      doc.moveDown(0.25);
      doc.fontSize(9).fillColor('#444').text(
        'Fecha | Tipo | Concepto | Descripción | Monto',
      );
      doc.fillColor('#000');

      const rows = model.movimientos.slice(0, 800);
      for (const m of rows) {
        const fecha = m.fecha ? toIsoDateOnly(new Date(m.fecha)) : '';
        const tipo = m.tipo;
        const concepto = m.concepto?.nombre ?? '';
        const desc = (m.descripcion ?? '').toString().slice(0, 60);
        const monto = `${m.monto} ${m.moneda ?? ''}`;

        doc.fontSize(9).text(`${fecha} | ${tipo} | ${concepto} | ${desc} | ${monto}`);
        if (doc.y > 740) {
          doc.addPage();
        }
      }

      if (model.movimientosMeta?.totalElementos && model.movimientosMeta.totalElementos > rows.length) {
        doc.moveDown(0.5);
        doc
          .fontSize(9)
          .fillColor('#666')
          .text(
            `Nota: el reporte incluye una muestra de ${rows.length} movimientos (de ${model.movimientosMeta.totalElementos}). Para exportar más, incrementa limiteMovimientos o usa Excel.`,
          );
        doc.fillColor('#000');
      }
    }

    doc.end();
    return endPromise;
  }

  private formatCambio(c: any): string {
    const abs = Number(c?.absoluto ?? 0);
    const pct = Number(c?.porcentual ?? 0);
    const pctStr = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : `${pct}%`;
    return `${abs} (${pctStr})`;
  }

  private async generarXlsx(model: any): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'LitFinance';
    wb.created = model.generatedAt;

    const wsResumen = wb.addWorksheet('Resumen', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsResumen.columns = [
      { header: 'Campo', key: 'campo', width: 28 },
      { header: 'Valor', key: 'valor', width: 60 },
    ];

    wsResumen.addRow({ campo: 'Generado', valor: model.generatedAt.toISOString() });
    wsResumen.addRow({ campo: 'Usuario', valor: `${model.user.nombre}${model.user.email ? ` (${model.user.email})` : ''}` });
    wsResumen.addRow({ campo: 'Periodo', valor: `${toIsoDateOnly(new Date(model.periodo.fechaInicio))} a ${toIsoDateOnly(new Date(model.periodo.fechaFin))}` });
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

    // Insights
    const wsInsights = wb.addWorksheet('Insights');
    wsInsights.columns = [
      { header: 'Prioridad', key: 'prioridad', width: 14 },
      { header: 'Título', key: 'titulo', width: 32 },
      { header: 'Descripción', key: 'desc', width: 80 },
      { header: 'Acción sugerida', key: 'accion', width: 40 },
    ];
    for (const ins of model.resumen.insights ?? []) {
      wsInsights.addRow({
        prioridad: ins.prioridad ?? '',
        titulo: ins.titulo ?? '',
        desc: ins.descripcion ?? '',
        accion: ins.accionSugerida ?? '',
      });
    }

    // Serie mensual
    const wsSerie = wb.addWorksheet('SerieMensual');
    wsSerie.columns = [
      { header: 'Mes', key: 'mes', width: 12 },
      { header: 'Ingresos', key: 'ing', width: 14 },
      { header: 'Gastos', key: 'gas', width: 14 },
      { header: 'Balance', key: 'bal', width: 14 },
      { header: 'Movimientos', key: 'mov', width: 14 },
    ];
    for (const s of model.resumen.serieMensual ?? []) {
      wsSerie.addRow({ mes: s.mes, ing: s.ingresos, gas: s.gastos, bal: s.balance, mov: s.movimientos });
    }

    // Tops
    const wsTop = wb.addWorksheet('TopConceptosGasto');
    wsTop.columns = [
      { header: 'Concepto', key: 'concepto', width: 36 },
      { header: 'Total', key: 'total', width: 16 },
      { header: 'Porcentaje', key: 'pct', width: 14 },
      { header: 'Movimientos', key: 'mov', width: 14 },
    ];
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
    for (const r of model.resumen.recurrentes ?? []) {
      wsRec.addRow({ nombre: r.nombre, total: r.total, pct: r.porcentaje, cargos: r.cargos });
    }

    // Movimientos
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

    // Header formatting
    for (const ws of wb.worksheets) {
      const row1 = ws.getRow(1);
      row1.font = { bold: true };
      row1.alignment = { vertical: 'middle' };
    }

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as any);
  }
}
