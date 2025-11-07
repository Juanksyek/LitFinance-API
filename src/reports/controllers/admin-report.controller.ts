import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus, Logger, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserReportService } from '../services/user-report.service';
import { UpdateUserReportStatusDto } from '../dto/user-report.dto';
import { ReportFiltersDto } from '../dto/web-report.dto';

@Controller('reports/admin')
@UseGuards(JwtAuthGuard)
export class AdminReportController {
  private readonly logger = new Logger(AdminReportController.name);

  constructor(private readonly userReportService: UserReportService) {}

  /**
   * Middleware para verificar permisos de admin
   */
  private verificarPermisoAdmin(user: any): void {
    if (!user.isAdmin && user.role !== 'admin') {
      throw new ForbiddenException('Se requieren permisos de administrador');
    }
  }

  /**
   * Obtener todos los reportes de usuarios (solo admins)
   * GET /reports/admin/user-reports
   */
  @Get('user-reports')
  async obtenerTodosLosReportes(
    @Query() filtros: ReportFiltersDto,
    @Request() req: any
  ) {
    try {
      this.verificarPermisoAdmin(req.user);
      
      const resultado = await this.userReportService.obtenerTodosLosReportes(filtros);
      
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
      this.logger.error(`Error al obtener reportes para admin ${req.user?.id}:`, error);
      throw error;
    }
  }

  /**
   * Obtener un reporte específico (solo admins)
   * GET /reports/admin/user-reports/:ticketId
   */
  @Get('user-reports/:ticketId')
  async obtenerReporte(
    @Param('ticketId') ticketId: string,
    @Request() req: any
  ) {
    try {
      this.verificarPermisoAdmin(req.user);
      
      const reporte = await this.userReportService.obtenerReporte('', ticketId);
      
      return {
        success: true,
        data: reporte
      };
    } catch (error) {
      this.logger.error(`Error al obtener reporte ${ticketId} para admin ${req.user?.id}:`, error);
      throw error;
    }
  }

  /**
   * Actualizar estado de un reporte (solo admins)
   * PATCH /reports/admin/user-reports/status
   */
  @Patch('user-reports/status')
  @HttpCode(HttpStatus.OK)
  async actualizarEstadoReporte(
    @Body() updateDto: UpdateUserReportStatusDto,
    @Request() req: any
  ) {
    try {
      this.verificarPermisoAdmin(req.user);
      
      const adminId = req.user.id;
      
      this.logger.log(`Admin ${adminId} actualizando reporte ${updateDto.ticketId} a estado ${updateDto.nuevoEstado}`);
      
      const reporteActualizado = await this.userReportService.actualizarEstadoReporte(
        updateDto,
        adminId
      );
      
      return {
        success: true,
        message: 'Estado del reporte actualizado exitosamente',
        data: {
          ticketId: reporteActualizado.ticketId,
          estadoAnterior: reporteActualizado.historialEstados[reporteActualizado.historialEstados.length - 2]?.estado,
          estadoNuevo: reporteActualizado.estado,
          fechaActualizacion: reporteActualizado.updatedAt
        }
      };
    } catch (error) {
      this.logger.error(`Error al actualizar estado del reporte por admin ${req.user?.id}:`, error);
      throw error;
    }
  }

  /**
   * Obtener estadísticas generales de reportes (solo admins)
   * GET /reports/admin/statistics
   */
  @Get('statistics')
  async obtenerEstadisticas(@Request() req: any) {
    try {
      this.verificarPermisoAdmin(req.user);
      
      const estadisticas = await this.userReportService.obtenerEstadisticas();
      
      return {
        success: true,
        data: estadisticas
      };
    } catch (error) {
      this.logger.error(`Error al obtener estadísticas para admin ${req.user?.id}:`, error);
      throw error;
    }
  }

  /**
   * Obtener reportes por prioridad (solo admins)
   * GET /reports/admin/priority/:prioridad
   */
  @Get('priority/:prioridad')
  async obtenerReportesPorPrioridad(
    @Param('prioridad') prioridad: string,
    @Query() filtros: ReportFiltersDto,
    @Request() req: any
  ) {
    try {
      this.verificarPermisoAdmin(req.user);
      
      const filtrosConPrioridad = { ...filtros, prioridad };
      const resultado = await this.userReportService.obtenerTodosLosReportes(filtrosConPrioridad);
      
      return {
        success: true,
        data: resultado,
        meta: {
          prioridad,
          total: resultado.total,
          pagina: resultado.pagina,
          limite: resultado.limite
        }
      };
    } catch (error) {
      this.logger.error(`Error al obtener reportes por prioridad ${prioridad} para admin ${req.user?.id}:`, error);
      throw error;
    }
  }

  /**
   * Asignar reporte a un admin (solo admins)
   * PATCH /reports/admin/assign/:ticketId
   */
  @Patch('assign/:ticketId')
  @HttpCode(HttpStatus.OK)
  async asignarReporte(
    @Param('ticketId') ticketId: string,
    @Body('asignadoA') asignadoA: string,
    @Request() req: any
  ) {
    try {
      this.verificarPermisoAdmin(req.user);
      
      const adminId = req.user.id;
      
      // Actualizar el reporte con el admin asignado
      const updateDto: UpdateUserReportStatusDto = {
        ticketId,
        nuevoEstado: 'en_progreso',
        comentario: `Reporte asignado a admin ${asignadoA}`
      };
      
      const reporteActualizado = await this.userReportService.actualizarEstadoReporte(
        updateDto,
        adminId
      );
      
      this.logger.log(`Reporte ${ticketId} asignado a ${asignadoA} por admin ${adminId}`);
      
      return {
        success: true,
        message: 'Reporte asignado exitosamente',
        data: {
          ticketId: reporteActualizado.ticketId,
          asignadoA,
          estado: reporteActualizado.estado
        }
      };
    } catch (error) {
      this.logger.error(`Error al asignar reporte ${ticketId} por admin ${req.user?.id}:`, error);
      throw error;
    }
  }
}