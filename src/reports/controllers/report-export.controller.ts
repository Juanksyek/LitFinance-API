import { Controller, Get, Query, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlanAction } from '../../plan-config/decorators/plan-action.decorator';
import { PlanActionGuard } from '../../plan-config/guards/plan-action.guard';
import { ExportReportQueryDto } from '../dto/report-export.dto';
import { ReportExportService } from '../services/report-export.service';

@UseGuards(JwtAuthGuard)
@Controller('reportes')
export class ReportExportController {
  constructor(private readonly reportExportService: ReportExportService) {}

  /**
   * GET /reportes/export
   * Premium-only: genera un reporte exportable y lo devuelve como base64.
   */
  @Get('export')
  @PlanAction('reporte')
  @UseGuards(PlanActionGuard)
  async exportar(@Req() req: any, @Query() q: ExportReportQueryDto) {
    const userId = req?.user?.id ?? req?.user?._id ?? req?.user?.sub;
    if (!userId) throw new UnauthorizedException('Usuario no autenticado');

    return this.reportExportService.exportar(String(userId), q);
  }
}
