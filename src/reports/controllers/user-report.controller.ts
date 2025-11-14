import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserReportService } from '../services/user-report.service';
import { CreateUserReportDto, UpdateUserReportStatusDto } from '../dto/user-report.dto';
import { ReportFiltersDto } from '../dto/web-report.dto';

@Controller('reports/user')
@UseGuards(JwtAuthGuard)
export class UserReportController {
  private readonly logger = new Logger(UserReportController.name);

  constructor(private readonly userReportService: UserReportService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crearReporte(
    @Body() createReportDto: CreateUserReportDto,
    @Request() req: any
  ) {
    try {
      const userId = req.user.id;
      
      this.logger.log(`Usuario ${userId} creando nuevo reporte: ${createReportDto.titulo}`);
      
      const reporte = await this.userReportService.crearReporte(userId, createReportDto);
      
      return {
        success: true,
        message: 'Reporte creado exitosamente',
        data: {
          ticketId: reporte.ticketId,
          titulo: reporte.titulo,
          categoria: reporte.categoria,
          estado: reporte.estado,
          prioridad: reporte.prioridad,
          fechaCreacion: reporte.createdAt
        }
      };
    } catch (error) {
      this.logger.error(`Error al crear reporte para usuario ${req.user?.id}:`, error);
      throw error;
    }
  }

  @Get('mis-reportes')
  async obtenerMisReportes(
    @Query() filtros: ReportFiltersDto,
    @Request() req: any
  ) {
    try {
      const userId = req.user.id;
      
      const resultado = await this.userReportService.obtenerReportesUsuario(userId, filtros);
      
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
      this.logger.error(`Error al obtener reportes del usuario ${req.user?.id}:`, error);
      throw error;
    }
  }

  @Get('ticket/:ticketId')
  async obtenerReporte(
    @Param('ticketId') ticketId: string,
    @Request() req: any
  ) {
    try {
      const userId = req.user.id;
      
      const reporte = await this.userReportService.obtenerReporte(userId, ticketId);
      
      return {
        success: true,
        data: reporte
      };
    } catch (error) {
      this.logger.error(`Error al obtener reporte ${ticketId} del usuario ${req.user?.id}:`, error);
      throw error;
    }
  }

  @Get('resumen')
  async obtenerResumenReportes(@Request() req: any) {
    try {
      const userId = req.user.id;
      
      const [
        totalReportes,
        reportesAbiertos,
        reportesResueltos,
        reportesRecientes
      ] = await Promise.all([
        this.userReportService.obtenerReportesUsuario(userId, { limite: '1000' }),
        this.userReportService.obtenerReportesUsuario(userId, { estado: 'abierto', limite: '100' }),
        this.userReportService.obtenerReportesUsuario(userId, { estado: 'resuelto', limite: '100' }),
        this.userReportService.obtenerReportesUsuario(userId, { limite: '5' })
      ]);

      return {
        success: true,
        data: {
          totalReportes: totalReportes.total,
          reportesAbiertos: reportesAbiertos.total,
          reportesResueltos: reportesResueltos.total,
          reportesRecientes: reportesRecientes.reportes.slice(0, 5)
        }
      };
    } catch (error) {
      this.logger.error(`Error al obtener resumen de reportes del usuario ${req.user?.id}:`, error);
      throw error;
    }
  }
}