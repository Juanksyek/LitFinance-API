import { Injectable, NestMiddleware, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityValidationMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SecurityValidationMiddleware.name);

  // Lista expandida de patrones maliciosos
  private readonly patronesMaliciosos = [
    // Inyección SQL
    /(\bunion\b|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\bcreate\b|\balter\b)/i,
    /(\bwhere\b.*=.*\bor\b|\bwhere\b.*\band\b.*=)/i,
    /(\'|\"|;|--|\||\*)/,
    
    // Inyección NoSQL
    /(\$where|\$ne|\$gt|\$lt|\$in|\$nin|\$regex|\$exists)/i,
    /(\{\$.*\}|\[\$.*\])/,
    
    // XSS
    /(<script|javascript:|vbscript:|onload|onerror|onclick|onmouseover)/i,
    /(<iframe|<object|<embed|<link|<meta)/i,
    /(alert\(|confirm\(|prompt\(|document\.|window\.|eval\()/i,
    
    // Inyección de comandos
    /(\bcat\b|\bls\b|\bps\b|\bkill\b|\brm\b|\bmv\b|\bcp\b|\bchmod\b)/i,
    /(&&|\|\||;|`|\$\()/,
    /(\bsudo\b|\bsu\b|\bchroot\b|\bwget\b|\bcurl\b)/i,
    
    // Path traversal
    /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e%5c)/i,
    /(\/etc\/passwd|\/etc\/shadow|\.ssh\/|\.aws\/)/i,
    
    // Patrones de spam/phishing
    /(\bcasino\b|\bgambling\b|\bbitcoin\b|\bcryptocurrency\b)/i,
    /(\bviagra\b|\bporn\b|\bxxx\b|\badult\b)/i,
    /(\binvestment\b|\bloan\b|\bmortgage\b|\bget\s+rich\b)/i,
    
    // Patrones sospechosos adicionales
    /(base64_decode|eval|exec|system|shell_exec)/i,
    /(\bfile_get_contents\b|\bfopen\b|\bfwrite\b)/i,
    /(\.php|\.asp|\.jsp|\.cgi)/i
  ];

  // IPs bloqueadas (se puede expandir dinámicamente)
  private readonly ipsBloqueadas = new Set([
    '0.0.0.0',
    '127.0.0.1', // Solo para testing, remover en producción
  ]);

  // User agents sospechosos
  private readonly userAgentsSospechosos = [
    /bot|crawler|spider|scraper/i,
    /curl|wget|postman/i,
    /python|perl|ruby|java/i,
    /sqlmap|nmap|nikto|burp/i
  ];

  use(req: Request, res: Response, next: NextFunction) {
    try {
      const ipAddress = this.obtenerIPReal(req);
      const userAgent = req.headers['user-agent'] || '';
      const referer = req.headers['referer'] || '';
      
      // 1. Verificar IP bloqueada
      if (this.esIPBloqueada(ipAddress)) {
        this.logger.warn(`Acceso bloqueado desde IP: ${ipAddress}`);
        throw new HttpException('Acceso denegado', HttpStatus.FORBIDDEN);
      }

      // 2. Verificar User Agent sospechoso
      if (this.esUserAgentSospechoso(userAgent)) {
        this.logger.warn(`User Agent sospechoso detectado: ${userAgent} desde IP: ${ipAddress}`);
        // No bloquear automáticamente, solo loggear
      }

      // 3. Validar contenido del cuerpo (solo para POST/PUT/PATCH)
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
        this.validarContenidoMalicioso(req.body, ipAddress);
      }

      // 4. Validar parámetros de consulta
      if (Object.keys(req.query).length > 0) {
        this.validarParametrosConsulta(req.query, ipAddress);
      }

      // 5. Logging de seguridad
      this.loggearAcceso(req, ipAddress, userAgent, referer);

      next();
    } catch (error) {
      this.logger.error(`Error en middleware de seguridad: ${error.message}`, {
        ip: this.obtenerIPReal(req),
        userAgent: req.headers['user-agent'],
        path: req.path,
        method: req.method
      });
      throw error;
    }
  }

  /**
   * Obtener la IP real del cliente
   */
  private obtenerIPReal(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (req.headers['x-real-ip'] as string) ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Verificar si una IP está bloqueada
   */
  private esIPBloqueada(ip: string): boolean {
    return this.ipsBloqueadas.has(ip);
  }

  /**
   * Verificar si el User Agent es sospechoso
   */
  private esUserAgentSospechoso(userAgent: string): boolean {
    return this.userAgentsSospechosos.some(pattern => pattern.test(userAgent));
  }

  /**
   * Validar contenido malicioso en el cuerpo de la petición
   */
  private validarContenidoMalicioso(body: any, ip: string): void {
    const contenidoTexto = JSON.stringify(body).toLowerCase();
    
    for (const patron of this.patronesMaliciosos) {
      if (patron.test(contenidoTexto)) {
        this.logger.error(`Contenido malicioso detectado desde IP: ${ip}`, {
          patron: patron.toString(),
          contenido: contenidoTexto.substring(0, 200) // Solo primeros 200 caracteres
        });
        throw new HttpException(
          'Contenido no permitido detectado',
          HttpStatus.BAD_REQUEST
        );
      }
    }

    // Validaciones adicionales específicas
    this.validarLongitudCampos(body);
    this.validarCaracteresEspeciales(body);
  }

  /**
   * Validar parámetros de consulta
   */
  private validarParametrosConsulta(query: any, ip: string): void {
    const queryString = JSON.stringify(query).toLowerCase();
    
    for (const patron of this.patronesMaliciosos) {
      if (patron.test(queryString)) {
        this.logger.error(`Parámetros maliciosos detectados desde IP: ${ip}`, {
          patron: patron.toString(),
          query: queryString
        });
        throw new HttpException(
          'Parámetros no válidos',
          HttpStatus.BAD_REQUEST
        );
      }
    }
  }

  /**
   * Validar longitud de campos
   */
  private validarLongitudCampos(body: any): void {
    const limites = {
      titulo: 200,
      asunto: 150,
      descripcion: 2000,
      email: 100,
      comentario: 1000
    };

    for (const [campo, limite] of Object.entries(limites)) {
      if (body[campo] && typeof body[campo] === 'string' && body[campo].length > limite) {
        throw new HttpException(
          `El campo ${campo} excede la longitud máxima permitida`,
          HttpStatus.BAD_REQUEST
        );
      }
    }
  }

  /**
   * Validar caracteres especiales peligrosos
   */
  private validarCaracteresEspeciales(body: any): void {
    const caracteresProhibidos = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
    const contenidoTexto = JSON.stringify(body);
    
    if (caracteresProhibidos.test(contenidoTexto)) {
      throw new HttpException(
        'Caracteres no válidos detectados',
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Logging de accesos para auditoría de seguridad
   */
  private loggearAcceso(req: Request, ip: string, userAgent: string, referer: string): void {
    // Solo loggear accesos a endpoints de reportes
    if (req.path.includes('/reports/')) {
      this.logger.log(`Acceso a endpoint de reportes`, {
        ip,
        method: req.method,
        path: req.path,
        userAgent,
        referer,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Método público para agregar IP a lista negra dinámicamente
   */
  public bloquearIP(ip: string): void {
    this.ipsBloqueadas.add(ip);
    this.logger.warn(`IP ${ip} agregada a lista negra`);
  }

  /**
   * Método público para remover IP de lista negra
   */
  public desbloquearIP(ip: string): void {
    this.ipsBloqueadas.delete(ip);
    this.logger.log(`IP ${ip} removida de lista negra`);
  }
}