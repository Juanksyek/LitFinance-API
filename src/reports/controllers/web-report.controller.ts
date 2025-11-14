import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus, Logger, Ip, Headers, UseInterceptors, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WebReportService } from '../services/web-report.service';
import { CreateWebReportDto, UpdateWebReportStatusDto, ReportFiltersDto } from '../dto/web-report.dto';

@Controller('reports/web')
export class WebReportController {
  private readonly logger = new Logger(WebReportController.name);

  constructor(private readonly webReportService: WebReportService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crearReporteWeb(
    @Body() createReportDto: CreateWebReportDto,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
    @Headers('referer') referer?: string
  ) {
    try {
      this.logger.log(`Nuevo reporte web desde IP ${ipAddress}: ${createReportDto.asunto}`);
      
      const reporte = await this.webReportService.crearReporteWeb(
        createReportDto,
        ipAddress,
        userAgent,
        referer
      );
      
      return {
        success: true,
        message: 'Reporte de ayuda enviado exitosamente. Te contactaremos pronto.',
        data: {
          ticketId: reporte.ticketId,
          estado: reporte.estado,
          fechaCreacion: reporte.createdAt,
          tiempoEstimadoRespuesta: '24-48 horas'
        }
      };
    } catch (error) {
      this.logger.error(`Error al crear reporte web desde IP ${ipAddress}:`, error);
      throw error;
    }
  }

  @Get('status/:ticketId')
  async obtenerEstadoReporte(
    @Param('ticketId') ticketId: string,
    @Ip() ipAddress: string
  ) {
    try {
      const reportes = await this.webReportService.obtenerReportesWeb({ limite: '1' });
      const reporte = reportes.reportes.find(r => r.ticketId === ticketId);
      
      if (!reporte) {
        return {
          success: false,
          message: 'Ticket no encontrado'
        };
      }
      
      return {
        success: true,
        data: {
          ticketId: reporte.ticketId,
          estado: reporte.estado,
          fechaCreacion: reporte.createdAt,
          fechaActualizacion: reporte.updatedAt,
          tieneRespuesta: !!reporte.respuestaAdmin
        }
      };
    } catch (error) {
      this.logger.error(`Error al obtener estado del reporte ${ticketId} desde IP ${ipAddress}:`, error);
      throw error;
    }
  }

  /**
   * Obtener todos los reportes web (solo admins)
   * GET /reports/web/admin
   */
  @Get('admin')
  @UseGuards(JwtAuthGuard)
  async obtenerReportesWeb(
    @Query() filtros: ReportFiltersDto,
    @Request() req: any
  ) {
    try {
      this.verificarPermisoAdmin(req.user);
      
      const resultado = await this.webReportService.obtenerReportesWeb(filtros);
      
      return {
        success: true,
        data: resultado,
        meta: {
          total: resultado.total,
          pagina: resultado.pagina,
          limite: resultado.limite,
          totalPaginas: Math.ceil(resultado.total / resultado.limite)
        }
      };
    } catch (error) {
      this.logger.error(`Error al obtener reportes web para admin ${req.user?.id}:`, error);
      throw error;
    }
  }

  /**
   * Actualizar estado de reporte web (solo admins)
   * PATCH /reports/web/admin/status
   */
  @Patch('admin/status')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async actualizarEstadoReporteWeb(
    @Body() updateDto: UpdateWebReportStatusDto,
    @Request() req: any
  ) {
    try {
      this.verificarPermisoAdmin(req.user);
      
      const adminId = req.user.id;
      
      this.logger.log(`Admin ${adminId} actualizando reporte web ${updateDto.ticketId} a estado ${updateDto.nuevoEstado}`);
      
      const reporteActualizado = await this.webReportService.actualizarEstadoReporteWeb(
        updateDto,
        adminId
      );
      
      return {
        success: true,
        message: 'Estado del reporte web actualizado exitosamente',
        data: {
          ticketId: reporteActualizado.ticketId,
          estadoNuevo: reporteActualizado.estado,
          fechaActualizacion: reporteActualizado.updatedAt
        }
      };
    } catch (error) {
      this.logger.error(`Error al actualizar estado del reporte web por admin ${req.user?.id}:`, error);
      throw error;
    }
  }

  /**
   * Obtener estadísticas de seguridad (solo admins)
   * GET /reports/web/admin/security-stats
   */
  @Get('admin/security-stats')
  @UseGuards(JwtAuthGuard)
  async obtenerEstadisticasSeguridad(@Request() req: any) {
    try {
      this.verificarPermisoAdmin(req.user);
      
      const estadisticas = await this.webReportService.obtenerEstadisticasSeguridad();
      
      return {
        success: true,
        data: estadisticas
      };
    } catch (error) {
      this.logger.error(`Error al obtener estadísticas de seguridad para admin ${req.user?.id}:`, error);
      throw error;
    }
  }

  /**
   * Obtener reportes sospechosos (solo admins)
   * GET /reports/web/admin/suspicious
   */
  @Get('admin/suspicious')
  @UseGuards(JwtAuthGuard)
  async obtenerReportesSospechosos(
    @Query() filtros: ReportFiltersDto,
    @Request() req: any
  ) {
    try {
      this.verificarPermisoAdmin(req.user);
      
      // Filtrar solo reportes sospechosos
      const filtrosSospechosos = { ...filtros };
      const resultado = await this.webReportService.obtenerReportesWeb(filtrosSospechosos);
      
      // Filtrar en memoria los sospechosos (idealmente esto se haría en la query)
      const reportesSospechosos = resultado.reportes.filter(r => r.esSospechoso || r.puntuacionRiesgo > 50);
      
      return {
        success: true,
        data: {
          reportes: reportesSospechosos,
          total: reportesSospechosos.length,
          pagina: resultado.pagina,
          limite: resultado.limite
        }
      };
    } catch (error) {
      this.logger.error(`Error al obtener reportes sospechosos para admin ${req.user?.id}:`, error);
      throw error;
    }
  }

  /**
   * Marcar reporte como spam (solo admins)
   * PATCH /reports/web/admin/mark-spam/:ticketId
   */
  @Patch('admin/mark-spam/:ticketId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async marcarComoSpam(
    @Param('ticketId') ticketId: string,
    @Request() req: any
  ) {
    try {
      this.verificarPermisoAdmin(req.user);
      
      const adminId = req.user.id;
      
      const updateDto: UpdateWebReportStatusDto = {
        ticketId,
        nuevoEstado: 'spam',
        respuestaAdmin: 'Marcado como spam por administrador'
      };
      
      const reporteActualizado = await this.webReportService.actualizarEstadoReporteWeb(
        updateDto,
        adminId
      );
      
      this.logger.log(`Reporte web ${ticketId} marcado como spam por admin ${adminId}`);
      
      return {
        success: true,
        message: 'Reporte marcado como spam exitosamente',
        data: {
          ticketId: reporteActualizado.ticketId,
          estado: reporteActualizado.estado
        }
      };
    } catch (error) {
      this.logger.error(`Error al marcar reporte ${ticketId} como spam por admin ${req.user?.id}:`, error);
      throw error;
    }
  }

  /**
   * Verificar permisos de administrador
   */
  private verificarPermisoAdmin(user: any): void {
    if (!user.isAdmin && user.role !== 'admin') {
      throw new ForbiddenException('Se requieren permisos de administrador');
    }
  }
}