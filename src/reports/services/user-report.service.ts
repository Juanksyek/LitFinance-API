import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { UserReport, UserReportDocument, ReportStatus } from '../schemas/user-report.schema';
import { User, UserDocument } from '../../user/schemas/user.schema/user.schema';
import { CreateUserReportDto, UpdateUserReportStatusDto } from '../dto/user-report.dto';
import { ReportFiltersDto } from '../dto/web-report.dto';

@Injectable()
export class UserReportService {
  private readonly logger = new Logger(UserReportService.name);

  constructor(
    @InjectModel(UserReport.name) private readonly userReportModel: Model<UserReportDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Crear un nuevo reporte de usuario autenticado
   */
  async crearReporte(userId: string, createReportDto: CreateUserReportDto): Promise<UserReport> {
    try {
      const usuario = await this.userModel.findOne({ id: userId });
      if (!usuario) {
        throw new NotFoundException('Usuario no encontrado');
      }

      const reportesAbiertos = await this.userReportModel.countDocuments({
        userId,
        estado: { $in: [ReportStatus.ABIERTO, ReportStatus.EN_PROGRESO] }
      });

      if (reportesAbiertos >= 5) {
        throw new BadRequestException('No puedes tener más de 5 reportes abiertos simultáneamente');
      }

      // Generar ID único para el ticket
      const ticketId = `USR-${Date.now()}-${uuidv4().substring(0, 8).toUpperCase()}`;

      // Crear el reporte con metadata completa del usuario
      const nuevoReporte = new this.userReportModel({
        ticketId,
        userId,
        titulo: createReportDto.titulo,
        descripcion: createReportDto.descripcion,
        categoria: createReportDto.categoria,
        prioridad: createReportDto.prioridad,
        metadataUsuario: {
          email: usuario.email,
          nombre: (usuario as any).nombre || 'Usuario',
          monedaPreferencia: usuario.monedaPreferencia || 'USD',
          fechaRegistro: (usuario as any).createdAt || new Date(),
          ultimaActividad: (usuario as any).updatedAt || new Date(),
          version: createReportDto.version || '1.0.0',
          dispositivo: createReportDto.dispositivo
        },
        historialEstados: [{
          estado: ReportStatus.ABIERTO,
          fechaCambio: new Date(),
          cambiadoPor: userId,
          comentario: 'Reporte creado por el usuario'
        }]
      });

      const reporteGuardado = await nuevoReporte.save();
      
      this.logger.log(`Nuevo reporte creado: ${ticketId} por usuario ${userId}`);
      
      return reporteGuardado;

    } catch (error) {
      this.logger.error(`Error al crear reporte para usuario ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Obtener reportes del usuario con paginación
   */
  async obtenerReportesUsuario(
    userId: string, 
    filtros: ReportFiltersDto
  ): Promise<{ reportes: UserReport[]; total: number; pagina: number; limite: number }> {
    try {
      const limite = parseInt(filtros.limite || '10') || 10;
      const pagina = parseInt(filtros.pagina || '1') || 1;
      const skip = (pagina - 1) * limite;

      // Construir query con filtros
      const query: any = { userId };

      if (filtros.estado) {
        query.estado = filtros.estado;
      }

      if (filtros.fechaDesde || filtros.fechaHasta) {
        query.createdAt = {};
        if (filtros.fechaDesde) {
          query.createdAt.$gte = new Date(filtros.fechaDesde);
        }
        if (filtros.fechaHasta) {
          query.createdAt.$lte = new Date(filtros.fechaHasta + 'T23:59:59.999Z');
        }
      }

      if (filtros.prioridad) {
        query.prioridad = filtros.prioridad;
      }

      const [reportes, total] = await Promise.all([
        this.userReportModel
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limite)
          .lean(),
        this.userReportModel.countDocuments(query)
      ]);

      return { reportes, total, pagina, limite };

    } catch (error) {
      this.logger.error(`Error al obtener reportes del usuario ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Obtener un reporte específico del usuario
   */
  async obtenerReporte(userId: string, ticketId: string): Promise<UserReport> {
    try {
      const reporte = await this.userReportModel.findOne({ 
        ticketId, 
        userId 
      });

      if (!reporte) {
        throw new NotFoundException('Reporte no encontrado');
      }

      return reporte;

    } catch (error) {
      this.logger.error(`Error al obtener reporte ${ticketId} del usuario ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Actualizar estado de un reporte (solo admins)
   */
  async actualizarEstadoReporte(
    updateDto: UpdateUserReportStatusDto,
    adminId: string
  ): Promise<UserReport> {
    try {
      const reporte = await this.userReportModel.findOne({ 
        ticketId: updateDto.ticketId 
      });

      if (!reporte) {
        throw new NotFoundException('Reporte no encontrado');
      }

      // Validar transición de estado válida
      this.validarTransicionEstado(reporte.estado, updateDto.nuevoEstado as ReportStatus);

      // Actualizar el reporte
      const updateData: any = {
        estado: updateDto.nuevoEstado,
        updatedAt: new Date()
      };

      // Agregar respuesta admin si se proporciona
      if (updateDto.respuestaAdmin) {
        updateData.respuestaAdmin = updateDto.respuestaAdmin;
      }

      // Establecer fechas según el estado
      if (updateDto.nuevoEstado === ReportStatus.RESUELTO) {
        updateData.resolvidoEn = new Date();
        updateData.tiempoRespuestaMinutos = Math.floor(
          (Date.now() - reporte.createdAt.getTime()) / (1000 * 60)
        );
      } else if (updateDto.nuevoEstado === ReportStatus.CERRADO) {
        updateData.cerradoEn = new Date();
      }

      // Agregar al historial de estados
      const nuevoHistorial = {
        estado: updateDto.nuevoEstado as ReportStatus,
        fechaCambio: new Date(),
        cambiadoPor: adminId,
        comentario: updateDto.comentario || `Estado cambiado a ${updateDto.nuevoEstado}`
      };

      const reporteActualizado = await this.userReportModel.findOneAndUpdate(
        { ticketId: updateDto.ticketId },
        {
          ...updateData,
          $push: { historialEstados: nuevoHistorial }
        },
        { new: true }
      );

      this.logger.log(`Reporte ${updateDto.ticketId} actualizado a estado ${updateDto.nuevoEstado} por admin ${adminId}`);

      return reporteActualizado!;

    } catch (error) {
      this.logger.error(`Error al actualizar estado del reporte ${updateDto.ticketId}:`, error);
      throw error;
    }
  }

  /**
   * Obtener todos los reportes para administradores
   */
  async obtenerTodosLosReportes(
    filtros: ReportFiltersDto
  ): Promise<{ reportes: UserReport[]; total: number; pagina: number; limite: number }> {
    try {
      const limite = parseInt(filtros.limite || '20') || 20;
      const pagina = parseInt(filtros.pagina || '1') || 1;
      const skip = (pagina - 1) * limite;

      // Construir query con filtros
      const query: any = {};

      if (filtros.estado) {
        query.estado = filtros.estado;
      }

      if (filtros.fechaDesde || filtros.fechaHasta) {
        query.createdAt = {};
        if (filtros.fechaDesde) {
          query.createdAt.$gte = new Date(filtros.fechaDesde);
        }
        if (filtros.fechaHasta) {
          query.createdAt.$lte = new Date(filtros.fechaHasta + 'T23:59:59.999Z');
        }
      }

      if (filtros.prioridad) {
        query.prioridad = filtros.prioridad;
      }

      const [reportes, total] = await Promise.all([
        this.userReportModel
          .find(query)
          .sort({ prioridad: -1, createdAt: -1 })
          .skip(skip)
          .limit(limite)
          .lean(),
        this.userReportModel.countDocuments(query)
      ]);

      return { reportes, total, pagina, limite };

    } catch (error) {
      this.logger.error('Error al obtener todos los reportes:', error);
      throw error;
    }
  }

  /**
   * Obtener estadísticas de reportes
   */
  async obtenerEstadisticas(): Promise<any> {
    try {
      const [
        totalReportes,
        reportesPorEstado,
        reportesPorPrioridad,
        reportesPorCategoria,
        tiempoPromedioRespuesta
      ] = await Promise.all([
        this.userReportModel.countDocuments(),
        this.userReportModel.aggregate([
          { $group: { _id: '$estado', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]),
        this.userReportModel.aggregate([
          { $group: { _id: '$prioridad', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]),
        this.userReportModel.aggregate([
          { $group: { _id: '$categoria', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]),
        this.userReportModel.aggregate([
          { 
            $match: { 
              estado: ReportStatus.RESUELTO,
              tiempoRespuestaMinutos: { $gt: 0 }
            }
          },
          { 
            $group: { 
              _id: null, 
              promedioMinutos: { $avg: '$tiempoRespuestaMinutos' } 
            } 
          }
        ])
      ]);

      return {
        totalReportes,
        reportesPorEstado,
        reportesPorPrioridad,
        reportesPorCategoria,
        tiempoPromedioRespuestaMinutos: tiempoPromedioRespuesta[0]?.promedioMinutos || 0
      };

    } catch (error) {
      this.logger.error('Error al obtener estadísticas:', error);
      throw error;
    }
  }

  /**
   * Validar transición de estado
   */
  private validarTransicionEstado(estadoActual: ReportStatus, nuevoEstado: ReportStatus): void {
    const transicionesValidas: Record<ReportStatus, ReportStatus[]> = {
      [ReportStatus.ABIERTO]: [ReportStatus.EN_PROGRESO, ReportStatus.RECHAZADO, ReportStatus.CERRADO],
      [ReportStatus.EN_PROGRESO]: [ReportStatus.PAUSADO, ReportStatus.RESUELTO, ReportStatus.RECHAZADO],
      [ReportStatus.PAUSADO]: [ReportStatus.EN_PROGRESO, ReportStatus.CERRADO],
      [ReportStatus.RESUELTO]: [ReportStatus.CERRADO, ReportStatus.EN_PROGRESO],
      [ReportStatus.RECHAZADO]: [ReportStatus.CERRADO],
      [ReportStatus.CERRADO]: [] // Estado final
    };

    if (!transicionesValidas[estadoActual]?.includes(nuevoEstado)) {
      throw new BadRequestException(
        `Transición de estado no válida: ${estadoActual} -> ${nuevoEstado}`
      );
    }
  }
}