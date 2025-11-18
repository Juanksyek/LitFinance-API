import { Injectable, Logger, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { WebReport, WebReportDocument, WebReportStatus } from '../schemas/web-report.schema';
import { CreateWebReportDto, UpdateWebReportStatusDto, ReportFiltersDto } from '../dto/web-report.dto';

@Injectable()
export class WebReportService {
  private readonly logger = new Logger(WebReportService.name);
  
  // Lista de palabras prohibidas (puede expandirse)
  private readonly palabrasProhibidas = [
    'spam', 'hack', 'scam', 'virus', 'malware', 'phishing',
    'casino', 'gambling', 'porn', 'xxx', 'viagra', 'bitcoin',
    'cryptocurrency', 'investment', 'loan', 'mortgage'
  ];

  // Dominios de email sospechosos
  private readonly dominiosSospechosos = [
    '10minutemail.com', 'tempmail.org', 'guerrillamail.com',
    'mailinator.com', 'yopmail.com', 'temp-mail.org'
  ];

  constructor(
    @InjectModel(WebReport.name) private readonly webReportModel: Model<WebReportDocument>,
  ) {}

  /**
   * Crear un nuevo reporte web con validaciones de seguridad
   */
  async crearReporteWeb(
    createReportDto: CreateWebReportDto,
    ipAddress: string,
    userAgent: string,
    referer?: string
  ): Promise<WebReport> {
    try {
      // 1. Verificar rate limiting por IP
      await this.verificarRateLimitingIP(ipAddress);

      // 2. Validar contenido contra spam y contenido malicioso
      const validacionesContenido = await this.validarContenido(createReportDto);

      // 3. Verificar si el email es sospechoso
      const emailSospechoso = this.esEmailSospechoso(createReportDto.email);

      // 4. Calcular puntuación de riesgo
      const puntuacionRiesgo = this.calcularPuntuacionRiesgo(
        createReportDto,
        validacionesContenido,
        emailSospechoso,
        ipAddress
      );

      // 5. Bloquear si la puntuación de riesgo es muy alta
      if (puntuacionRiesgo > 80) {
        this.logger.warn(`Reporte bloqueado por alta puntuación de riesgo: ${puntuacionRiesgo}`, {
          ip: ipAddress,
          email: createReportDto.email,
          userAgent
        });
        throw new HttpException('Reporte rechazado por medidas de seguridad', HttpStatus.FORBIDDEN);
      }

      // 6. Generar ID único para el ticket
      const ticketId = `WEB-${Date.now()}-${uuidv4().substring(0, 8).toUpperCase()}`;

      // 7. Obtener intentos previos desde esta IP
      const intentosIP = await this.contarIntentosIP(ipAddress);

      // 8. Crear el reporte
      const nuevoReporte = new this.webReportModel({
        ticketId,
        email: createReportDto.email,
        asunto: createReportDto.asunto,
        descripcion: createReportDto.descripcion,
        ipAddress,
        userAgent,
        referer,
        esSospechoso: puntuacionRiesgo > 50,
        puntuacionRiesgo,
        intentosDesdeIP: intentosIP + 1,
        ultimoIntentoIP: new Date(),
        validacionesContenido,
        historialAcciones: [{
          accion: 'reporte_creado',
          fecha: new Date(),
          realizadaPor: 'sistema',
          detalles: `Creado desde IP ${ipAddress} con puntuación ${puntuacionRiesgo}`
        }]
      });

      // 9. Marcar automáticamente como spam si supera umbral
      if (puntuacionRiesgo > 70) {
        nuevoReporte.estado = WebReportStatus.SPAM;
        nuevoReporte.historialAcciones.push({
          accion: 'marcado_como_spam',
          fecha: new Date(),
          realizadaPor: 'sistema_automatico',
          detalles: `Puntuación de riesgo: ${puntuacionRiesgo}`
        });
      }

      const reporteGuardado = await nuevoReporte.save();

      this.logger.log(`Nuevo reporte web creado: ${ticketId} desde IP ${ipAddress}`, {
        puntuacionRiesgo,
        esSospechoso: nuevoReporte.esSospechoso
      });

      return reporteGuardado;

    } catch (error) {
      this.logger.error(`Error al crear reporte web desde IP ${ipAddress}:`, error);
      throw error;
    }
  }

  /**
   * Verificar rate limiting por IP
   */
  private async verificarRateLimitingIP(ipAddress: string): Promise<void> {
    const ahora = new Date();
    const hace1Hora = new Date(ahora.getTime() - 60 * 60 * 1000);
    const hace24Horas = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);

    const [reportesUltimaHora, reportesUltimas24h] = await Promise.all([
      this.webReportModel.countDocuments({
        ipAddress,
        createdAt: { $gte: hace1Hora }
      }),
      this.webReportModel.countDocuments({
        ipAddress,
        createdAt: { $gte: hace24Horas }
      })
    ]);

    // Límites estrictos
    if (reportesUltimaHora >= 2) {
      throw new HttpException(
        'Has excedido el límite de reportes por hora. Intenta más tarde.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    if (reportesUltimas24h >= 5) {
      throw new HttpException(
        'Has excedido el límite diario de reportes. Intenta mañana.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  /**
   * Validar contenido contra spam y inyecciones
   */
  private async validarContenido(dto: CreateWebReportDto): Promise<any> {
    const textoCompleto = `${dto.asunto} ${dto.descripcion}`.toLowerCase();
    
    // Detectar palabras prohibidas
    const palabrasEncontradas = this.palabrasProhibidas.filter(palabra =>
      textoCompleto.includes(palabra.toLowerCase())
    );

    // Detectar links externos sospechosos
    const regexLinks = /https?:\/\/[^\s]+/gi;
    const linksEncontrados = textoCompleto.match(regexLinks) || [];
    const contieneLinksExternos = linksEncontrados.length > 0;

    // Detectar patrones de inyección SQL/NoSQL
    const patronesInyeccion = [
      /(\$where|\$ne|\$gt|\$lt|\$in|\$nin)/i,
      /(union|select|insert|update|delete|drop|create|alter)/i,
      /(<script|javascript:|vbscript:|onload|onerror)/i,
      /(\{|\}|\[|\]|\$|;|'|"|\|)/
    ];

    const contieneInyeccion = patronesInyeccion.some(pattern => 
      pattern.test(textoCompleto)
    );

    // Calcular puntuación de spam
    let puntuacionSpam = 0;
    
    if (palabrasEncontradas.length > 0) puntuacionSpam += 30;
    if (contieneLinksExternos) puntuacionSpam += 20;
    if (contieneInyeccion) puntuacionSpam += 40;
    if (textoCompleto.length < 20) puntuacionSpam += 15;
    if (textoCompleto.length > 1200) puntuacionSpam += 10;
    
    // Detectar texto repetitivo
    const palabras = textoCompleto.split(/\s+/);
    const palabrasUnicas = new Set(palabras);
    if (palabras.length > 10 && palabrasUnicas.size / palabras.length < 0.5) {
      puntuacionSpam += 25;
    }

    return {
      contieneLinksExternos,
      contieneEmojisSospechosos: /[\u{1F600}-\u{1F64F}]{3,}/u.test(textoCompleto),
      longitudTexto: textoCompleto.length,
      palabrasProhibidas: palabrasEncontradas,
      puntuacionSpam: Math.min(puntuacionSpam, 100),
      contieneInyeccion
    };
  }

  /**
   * Verificar si el email es sospechoso
   */
  private esEmailSospechoso(email: string): boolean {
    const dominio = email.split('@')[1]?.toLowerCase();
    
    return this.dominiosSospechosos.includes(dominio) ||
           dominio?.includes('temp') ||
           dominio?.includes('fake') ||
           dominio?.includes('disposable');
  }

  /**
   * Calcular puntuación de riesgo general
   */
  private calcularPuntuacionRiesgo(
    dto: CreateWebReportDto,
    validaciones: any,
    emailSospechoso: boolean,
    ipAddress: string
  ): number {
    let puntuacion = 0;

    // Puntuación base del contenido
    puntuacion += validaciones.puntuacionSpam * 0.6;

    // Email sospechoso
    if (emailSospechoso) puntuacion += 25;

    // IP privada o localhost (desarrollo)
    if (ipAddress === '127.0.0.1' || ipAddress === '::1' || 
        ipAddress.startsWith('192.168.') || ipAddress.startsWith('10.')) {
      puntuacion += 10;
    }

    // Validaciones adicionales de inyección
    if (validaciones.contieneInyeccion) puntuacion += 30;

    return Math.min(Math.floor(puntuacion), 100);
  }

  /**
   * Contar intentos previos desde una IP
   */
  private async contarIntentosIP(ipAddress: string): Promise<number> {
    const hace24Horas = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    return await this.webReportModel.countDocuments({
      ipAddress,
      createdAt: { $gte: hace24Horas }
    });
  }

  /**
   * Actualizar estado de reporte web (solo admins)
   */
  async actualizarEstadoReporteWeb(
    updateDto: UpdateWebReportStatusDto,
    adminId: string
  ): Promise<WebReport> {
    try {
      const reporte = await this.webReportModel.findOne({ 
        ticketId: updateDto.ticketId 
      });

      if (!reporte) {
        throw new NotFoundException('Reporte no encontrado');
      }

      const updateData: any = {
        estado: updateDto.nuevoEstado,
        updatedAt: new Date()
      };

      if (updateDto.respuestaAdmin) {
        updateData.respuestaAdmin = updateDto.respuestaAdmin;
      }

      if (updateDto.nuevoEstado === WebReportStatus.RESPONDIDO) {
        updateData.respondidoEn = new Date();
      } else if (updateDto.nuevoEstado === WebReportStatus.CERRADO) {
        updateData.cerradoEn = new Date();
      }

      const nuevaAccion = {
        accion: `estado_cambiado_a_${updateDto.nuevoEstado}`,
        fecha: new Date(),
        realizadaPor: adminId,
        detalles: updateDto.respuestaAdmin || `Estado actualizado por admin`
      };

      const reporteActualizado = await this.webReportModel.findOneAndUpdate(
        { ticketId: updateDto.ticketId },
        {
          ...updateData,
          $push: { historialAcciones: nuevaAccion }
        },
        { new: true }
      );

      this.logger.log(`Reporte web ${updateDto.ticketId} actualizado a ${updateDto.nuevoEstado} por ${adminId}`);

      return reporteActualizado!;

    } catch (error) {
      this.logger.error(`Error al actualizar reporte web ${updateDto.ticketId}:`, error);
      throw error;
    }
  }

  /**
   * Obtener reportes web con filtros (solo admins)
   */
  async obtenerReportesWeb(
    filtros: ReportFiltersDto
  ): Promise<{ reportes: WebReport[]; total: number; pagina: number; limite: number }> {
    try {
      const limite = parseInt(filtros.limite || '20') || 20;
      const pagina = parseInt(filtros.pagina || '1') || 1;
      const skip = (pagina - 1) * limite;

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

      const [reportes, total] = await Promise.all([
        this.webReportModel
          .find(query)
          .sort({ puntuacionRiesgo: -1, createdAt: -1 })
          .skip(skip)
          .limit(limite)
          .lean(),
        this.webReportModel.countDocuments(query)
      ]);

      return { reportes, total, pagina, limite };

    } catch (error) {
      this.logger.error('Error al obtener reportes web:', error);
      throw error;
    }
  }

  /**
   * Obtener estadísticas de seguridad
   */
  async obtenerEstadisticasSeguridad(): Promise<any> {
    try {
      const [
        totalReportes,
        reportesSospechosos,
        reportesSpam,
        topIPs,
        puntuacionRiesgoPromedio
      ] = await Promise.all([
        this.webReportModel.countDocuments(),
        this.webReportModel.countDocuments({ esSospechoso: true }),
        this.webReportModel.countDocuments({ estado: WebReportStatus.SPAM }),
        this.webReportModel.aggregate([
          { $group: { _id: '$ipAddress', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]),
        this.webReportModel.aggregate([
          { $group: { _id: null, promedio: { $avg: '$puntuacionRiesgo' } } }
        ])
      ]);

      return {
        totalReportes,
        reportesSospechosos,
        reportesSpam,
        porcentajeSospechosos: totalReportes > 0 ? (reportesSospechosos / totalReportes * 100).toFixed(2) : 0,
        porcentajeSpam: totalReportes > 0 ? (reportesSpam / totalReportes * 100).toFixed(2) : 0,
        topIPs,
        puntuacionRiesgoPromedio: puntuacionRiesgoPromedio[0]?.promedio || 0
      };

    } catch (error) {
      this.logger.error('Error al obtener estadísticas de seguridad:', error);
      throw error;
    }
  }
}