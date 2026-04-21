import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreditCard, CreditCardDocument } from './schemas/credit-card.schema';
import { CreateCreditCardDto, UpdateCreditCardDto, AddMovimientoDto, MovimientosQueryDto } from './dto/credit-card.dto';
import { generateUniqueId } from '../utils/generate-id';
import { UserService } from '../user/user.service';
import { PlanConfigService } from '../plan-config/plan-config.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { DashboardVersionService } from '../user/services/dashboard-version.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateTransactionDto } from '../transactions/dto/create-transaction.dto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Calcula la próxima ocurrencia de un día-del-mes (diaNum) a partir de hoy.
 * Siempre retorna una fecha futura.
 */
function siguienteOcurrencia(diaNum: number): Date {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth(); // 0-indexed

  const diasEnMes = (a: number, m: number) => new Date(a, m + 1, 0).getDate();
  const clamp = (dia: number, maxDia: number) => Math.min(dia, maxDia);

  // Intenta este mes
  const maxEste = diasEnMes(anio, mes);
  const diaEste = clamp(diaNum, maxEste);
  const candidato = new Date(anio, mes, diaEste, 0, 0, 0, 0);

  if (candidato > hoy) return candidato;

  // Siguiente mes
  const nextMes = mes === 11 ? 0 : mes + 1;
  const nextAnio = mes === 11 ? anio + 1 : anio;
  const maxNext = diasEnMes(nextAnio, nextMes);
  return new Date(nextAnio, nextMes, clamp(diaNum, maxNext), 0, 0, 0, 0);
}

// ─── Salud financiera ─────────────────────────────────────────────────────────

export interface SaludFinanciera {
  limiteCredito: number;
  saldoUsado: number;
  saldoDisponible: number;
  utilizacion: number; // 0-100
  score: number; // 0-100
  label: 'excelente' | 'buena' | 'regular' | 'critica';
  pagoMinimo: number;
  alertas: string[];
}

function calcularSalud(card: CreditCard): SaludFinanciera {
  const limite = Number(card.limiteCredito ?? 0);
  const usado = Number(card.saldoUsado ?? 0);
  const disponible = Math.max(0, limite - usado);
  const utilizacion = limite > 0 ? Math.min(100, (usado / limite) * 100) : 0;
  const pctMin = Number(card.porcentajePagoMinimo ?? 5);
  const pagoMinimo = usado > 0 ? Math.max(0, (usado * pctMin) / 100) : 0;

  const alertas: string[] = [];

  let score: number;
  let label: SaludFinanciera['label'];

  if (utilizacion <= 10) {
    score = 100;
    label = 'excelente';
  } else if (utilizacion <= 30) {
    score = 80;
    label = 'buena';
  } else if (utilizacion <= 70) {
    score = 55;
    label = 'regular';
    alertas.push('Más del 30% del límite está utilizado. Considera hacer un pago.');
  } else {
    score = 20;
    label = 'critica';
    alertas.push('¡Utilización crítica! Más del 70% del límite está usado.');
  }

  if (disponible < limite * 0.1) {
    alertas.push('Saldo disponible muy bajo. Estás cerca del límite.');
  }

  if (card.proximaFechaPago) {
    const diasAlPago = Math.ceil(
      (card.proximaFechaPago.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    if (diasAlPago >= 0 && diasAlPago <= 5) {
      alertas.push(`Fecha de pago en ${diasAlPago} día(s). ¡No olvides pagar!`);
    }
  }

  if (card.proximaFechaCorte) {
    const diasAlCorte = Math.ceil(
      (card.proximaFechaCorte.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    if (diasAlCorte >= 0 && diasAlCorte <= 3) {
      alertas.push(`Fecha de corte en ${diasAlCorte} día(s).`);
    }
  }

  return { limiteCredito: limite, saldoUsado: usado, saldoDisponible: disponible, utilizacion, score, label, pagoMinimo, alertas };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class CreditCardService {
  private readonly logger = new Logger(CreditCardService.name);

  constructor(
    @InjectModel(CreditCard.name)
    private readonly creditCardModel: Model<CreditCardDocument>,
    private readonly userService: UserService,
    private readonly planConfigService: PlanConfigService,
    private readonly notificacionesService: NotificacionesService,
    private readonly dashboardVersionService: DashboardVersionService,
    private readonly transactionsService: TransactionsService,
  ) {}

  // ─── Plan limit check ────────────────────────────────────────────────────

  private async enforceplanLimit(userId: string): Promise<void> {
    const profile = await this.userService.getProfile(userId);
    const planType = (profile as any)?.planType ?? 'free_plan';
    const config = await this.planConfigService.findByPlanType(planType);
    const limit = config ? Number((config as any).tarjetasPorUsuario ?? 1) : 1;
    if (limit === -1) return; // ilimitado
    const count = await this.creditCardModel.countDocuments({ userId, activa: { $ne: false }, pausadaPorPlan: { $ne: true } });
    if (count >= limit) {
      throw new ForbiddenException(
        `Tu plan (${planType === 'premium_plan' ? 'Premium' : 'Gratis'}) permite máximo ${limit} tarjeta(s). Actualiza tu plan para agregar más.`,
      );
    }
  }

  // ─── CRUD ───────────────────────────────────────────────────────────────

  async crear(dto: CreateCreditCardDto, userId: string): Promise<CreditCard> {
    await this.enforceplanLimit(userId);

    const cardId = await generateUniqueId(this.creditCardModel, 'cardId');
    const moneda = dto.moneda ?? 'MXN';
    const diaCorte = dto.diaCorte;
    const diaPago = dto.diaPago;

    const proximaFechaCorte = diaCorte ? siguienteOcurrencia(diaCorte) : undefined;
    const proximaFechaPago = diaPago ? siguienteOcurrencia(diaPago) : undefined;

    const recordatoriosPorDefecto =
      dto.recordatorios ??
      [
        ...(diaCorte ? [{ tipo: 'corte' as const, diasAntes: 3, activo: true }] : []),
        ...(diaPago ? [{ tipo: 'pago' as const, diasAntes: 3, activo: true }, { tipo: 'pago' as const, diasAntes: 1, activo: true }] : []),
      ];

    // Soporte para saldo inicial usado (importaciones).
    let inicialSaldoUsado = 0;
    if (dto.saldoUsado !== undefined) {
      const s = Number(dto.saldoUsado ?? 0);
      if (!Number.isFinite(s) || s < 0) throw new BadRequestException('saldoUsado inválido');
      if (s > dto.limiteCredito) throw new BadRequestException('saldoUsado no puede exceder el limiteCredito');
      inicialSaldoUsado = s;
    }

    const saludInicial = calcularSalud({
      limiteCredito: dto.limiteCredito,
      saldoUsado: inicialSaldoUsado,
      porcentajePagoMinimo: dto.porcentajePagoMinimo ?? 5,
      proximaFechaCorte,
      proximaFechaPago,
    } as unknown as CreditCard);

    const newCard = await this.creditCardModel.create({
      cardId,
      userId,
      nombre: dto.nombre,
      last4: dto.last4,
      emisor: dto.emisor,
      banco: dto.banco,
      color: dto.color ?? '#6366F1',
      moneda,
      limiteCredito: dto.limiteCredito,
      saldoUsado: inicialSaldoUsado,
      saldoDisponible: Math.max(0, dto.limiteCredito - inicialSaldoUsado),
      diaCorte,
      diaPago,
      proximaFechaCorte,
      proximaFechaPago,
      porcentajePagoMinimo: dto.porcentajePagoMinimo ?? 5,
      pagoMinimo: saludInicial.pagoMinimo,
      recordatorios: recordatoriosPorDefecto,
      utilizacion: saludInicial.utilizacion,
      saludScore: saludInicial.score,
      saludLabel: saludInicial.label,
    });

    await this.dashboardVersionService.touchDashboard(userId, 'creditcard.create');
    return newCard;
  }

  async listar(userId: string): Promise<Array<CreditCard & { salud: SaludFinanciera }>> {
    const cards = await this.creditCardModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    return (cards as any[]).map((c) => ({
      ...c,
      salud: calcularSalud(c as unknown as CreditCard),
    }));
  }

  async obtenerDetalle(cardId: string, userId: string): Promise<CreditCard & { salud: SaludFinanciera }> {
    const card = await this.creditCardModel.findOne({ cardId, userId }).lean();
    if (!card) throw new NotFoundException('Tarjeta no encontrada.');
    return { ...(card as any), salud: calcularSalud(card as unknown as CreditCard) };
  }

  async actualizar(cardId: string, userId: string, dto: UpdateCreditCardDto): Promise<CreditCard> {
    const card = await this.creditCardModel.findOne({ cardId, userId });
    if (!card) throw new NotFoundException('Tarjeta no encontrada.');

    const fields: Partial<CreditCard> = {};
    if (dto.nombre !== undefined) fields.nombre = dto.nombre;
    if (dto.last4 !== undefined) fields.last4 = dto.last4;
    if (dto.emisor !== undefined) fields.emisor = dto.emisor;
    if (dto.banco !== undefined) fields.banco = dto.banco;
    if (dto.color !== undefined) fields.color = dto.color;
    if (dto.recordatorios !== undefined) fields.recordatorios = dto.recordatorios as any;
    if (dto.porcentajePagoMinimo !== undefined) fields.porcentajePagoMinimo = dto.porcentajePagoMinimo;

    if (dto.limiteCredito !== undefined) {
      fields.limiteCredito = dto.limiteCredito;
      const usado = Number(card.saldoUsado ?? 0);
      fields.saldoDisponible = Math.max(0, dto.limiteCredito - usado);
      const salud = calcularSalud({ ...card.toObject(), ...fields } as unknown as CreditCard);
      fields.utilizacion = salud.utilizacion;
      fields.saludScore = salud.score;
      fields.saludLabel = salud.label;
    }

    // Permitir ajustar saldo usado manualmente
    if (dto.saldoUsado !== undefined) {
      const nuevoUsado = Number(dto.saldoUsado ?? 0);
      if (!Number.isFinite(nuevoUsado) || nuevoUsado < 0) throw new BadRequestException('saldoUsado inválido');
      const limite = dto.limiteCredito !== undefined ? dto.limiteCredito : Number(card.limiteCredito ?? 0);
      if (nuevoUsado > limite) throw new BadRequestException('saldoUsado no puede exceder el limiteCredito');
      fields.saldoUsado = nuevoUsado;
      fields.saldoDisponible = Math.max(0, limite - nuevoUsado);
      const salud = calcularSalud({ ...card.toObject(), ...fields } as unknown as CreditCard);
      fields.utilizacion = salud.utilizacion;
      fields.saludScore = salud.score;
      fields.saludLabel = salud.label;
      fields.pagoMinimo = salud.pagoMinimo;
    }

    if (dto.diaCorte !== undefined) {
      fields.diaCorte = dto.diaCorte;
      fields.proximaFechaCorte = siguienteOcurrencia(dto.diaCorte);
    }
    if (dto.diaPago !== undefined) {
      fields.diaPago = dto.diaPago;
      fields.proximaFechaPago = siguienteOcurrencia(dto.diaPago);
    }

    Object.assign(card, fields);
    await card.save();
    await this.dashboardVersionService.touchDashboard(userId, 'creditcard.update');
    return card;
  }

  async eliminar(cardId: string, userId: string): Promise<{ message: string }> {
    const card = await this.creditCardModel.findOne({ cardId, userId });
    if (!card) throw new NotFoundException('Tarjeta no encontrada.');
    await card.deleteOne();
    await this.dashboardVersionService.touchDashboard(userId, 'creditcard.delete');
    return { message: 'Tarjeta eliminada correctamente.' };
  }

  // ─── Movimientos ────────────────────────────────────────────────────────

  async agregarMovimiento(cardId: string, userId: string, dto: AddMovimientoDto): Promise<CreditCard> {
    const card = await this.creditCardModel.findOne({ cardId, userId });
    if (!card) throw new NotFoundException('Tarjeta no encontrada.');
    if (!card.activa || card.pausadaPorPlan) {
      throw new BadRequestException('La tarjeta no está activa.');
    }

    const moneda = dto.moneda ?? card.moneda;
    const monto = Number(dto.monto);
    const fecha = dto.fecha ? new Date(dto.fecha) : new Date();

    const movId = await generateUniqueId(this.creditCardModel, 'cardId', 9); // reutiliza uniqueId helper
    const movimiento: any = {
      movementId: `mv_${movId}`,
      tipo: dto.tipo,
      monto,
      moneda,
      descripcion: dto.descripcion,
      concepto: dto.concepto,
      fecha,
      registradoEn: new Date(),
    };

    // Actualizar saldo según tipo de movimiento
    const esEgreso = dto.tipo === 'compra';
    const esIngreso = dto.tipo === 'pago' || dto.tipo === 'credito';
    const esAjuste = dto.tipo === 'ajuste';

    let nuevoUsado = Number(card.saldoUsado ?? 0);

    if (esEgreso) {
      if (nuevoUsado + monto > Number(card.limiteCredito)) {
        throw new BadRequestException('El cargo excede el límite de crédito disponible.');
      }
      nuevoUsado += monto;
    } else if (esIngreso) {
      // Si se especifica cuentaId/subCuentaId para el pago, crear una transacción
      if (dto.cuentaId || dto.subCuentaId) {
        const txDto: CreateTransactionDto = {
          tipo: 'egreso',
          monto,
          moneda: moneda,
          concepto: dto.descripcion ?? `Pago tarjeta ${card.nombre}`,
          motivo: `Pago de tarjeta ${card.cardId}`,
          cuentaId: dto.cuentaId,
          subCuentaId: dto.subCuentaId,
          afectaCuenta: true,
          fecha: fecha.toISOString(),
        } as any;

        // Agregar metadata que identifique la tarjeta para reportes
        (txDto as any).metadata = { source: 'credit_card_payment', creditCardId: card.cardId };

        const txResult = await this.transactionsService.crear(txDto, userId);
        const createdTxId = txResult?.transaccion?.transaccionId ?? null;
        movimiento.transaccionId = createdTxId;

        // Solo después de crear la transacción actualizamos el saldo usado en la tarjeta
        nuevoUsado = Math.max(0, nuevoUsado - monto);
      } else {
        nuevoUsado = Math.max(0, nuevoUsado - monto);
      }
    } else if (esAjuste) {
      // Ajuste directo: dto.monto puede ser positivo (sube deuda) o negativo (baja deuda)
      // Por seguridad solo aceptamos positivos en el DTO, pero para ajuste lo restamos
      nuevoUsado = Math.max(0, nuevoUsado - monto);
    }

    const salud = calcularSalud({
      ...card.toObject(),
      saldoUsado: nuevoUsado,
      saldoDisponible: Math.max(0, Number(card.limiteCredito) - nuevoUsado),
    } as unknown as CreditCard);

    // Mantener solo los últimos 20 movimientos embebidos
    const movimientosRecientes = [movimiento, ...(card.movimientosRecientes ?? [])].slice(0, 20) as any;

    card.saldoUsado = nuevoUsado;
    card.saldoDisponible = Math.max(0, Number(card.limiteCredito) - nuevoUsado);
    card.pagoMinimo = salud.pagoMinimo;
    card.utilizacion = salud.utilizacion;
    card.saludScore = salud.score;
    card.saludLabel = salud.label;
    card.movimientosRecientes = movimientosRecientes;

    await card.save();
    await this.dashboardVersionService.touchDashboard(userId, 'creditcard.movement');
    return card;
  }

  async obtenerMovimientos(
    cardId: string,
    userId: string,
    query: MovimientosQueryDto,
  ): Promise<{ total: number; page: number; limit: number; data: any[] }> {
    const card = await this.creditCardModel.findOne({ cardId, userId }).lean();
    if (!card) throw new NotFoundException('Tarjeta no encontrada.');

    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));

    let movimientos = [...(card.movimientosRecientes ?? [])];

    if (query.desde) {
      const desde = new Date(query.desde);
      movimientos = movimientos.filter((m) => new Date(m.fecha) >= desde);
    }
    if (query.hasta) {
      const hasta = new Date(query.hasta);
      movimientos = movimientos.filter((m) => new Date(m.fecha) <= hasta);
    }

    // Ordenar más recientes primero
    movimientos.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    const total = movimientos.length;
    const skip = (page - 1) * limit;
    const data = movimientos.slice(skip, skip + limit);

    return { total, page, limit, data };
  }

  // ─── Salud individual ────────────────────────────────────────────────────

  async obtenerSalud(cardId: string, userId: string): Promise<SaludFinanciera & { card: { cardId: string; nombre: string } }> {
    const card = await this.creditCardModel.findOne({ cardId, userId }).lean();
    if (!card) throw new NotFoundException('Tarjeta no encontrada.');
    const salud = calcularSalud(card as unknown as CreditCard);
    return { ...salud, card: { cardId: (card as any).cardId, nombre: (card as any).nombre } };
  }

  // ─── Resumen para dashboard ─────────────────────────────────────────────

  async obtenerResumenDashboard(userId: string): Promise<{
    total: number;
    totalLimiteCredito: number;
    totalSaldoUsado: number;
    totalSaldoDisponible: number;
    utilizacionPromedio: number;
    saludGeneral: string;
    tarjetas: Array<{
      cardId: string;
      nombre: string;
      color: string;
      moneda: string;
      limiteCredito: number;
      saldoUsado: number;
      saldoDisponible: number;
      utilizacion: number;
      saludLabel: string;
      proximaFechaPago: Date | undefined;
      proximaFechaCorte: Date | undefined;
      pagoMinimo: number;
    }>;
  }> {
    const cards = await this.creditCardModel
      .find({ userId, activa: { $ne: false } })
      .select('cardId nombre color moneda limiteCredito saldoUsado saldoDisponible utilizacion saludLabel proximaFechaCorte proximaFechaPago pagoMinimo')
      .lean();

    const total = cards.length;
    let totalLimite = 0;
    let totalUsado = 0;
    let sumUtilizacion = 0;

    const tarjetas = (cards as any[]).map((c) => {
      totalLimite += Number(c.limiteCredito ?? 0);
      totalUsado += Number(c.saldoUsado ?? 0);
      sumUtilizacion += Number(c.utilizacion ?? 0);
      return {
        cardId: c.cardId,
        nombre: c.nombre,
        color: c.color ?? '#6366F1',
        moneda: c.moneda,
        limiteCredito: c.limiteCredito,
        saldoUsado: c.saldoUsado,
        saldoDisponible: c.saldoDisponible,
        utilizacion: c.utilizacion,
        saludLabel: c.saludLabel,
        proximaFechaPago: c.proximaFechaPago ?? null,
        proximaFechaCorte: c.proximaFechaCorte ?? null,
        pagoMinimo: c.pagoMinimo ?? 0,
      };
    });

    const utilizacionPromedio = total > 0 ? sumUtilizacion / total : 0;
    let saludGeneral = 'excelente';
    if (utilizacionPromedio > 70) saludGeneral = 'critica';
    else if (utilizacionPromedio > 30) saludGeneral = 'regular';
    else if (utilizacionPromedio > 10) saludGeneral = 'buena';

    return {
      total,
      totalLimiteCredito: totalLimite,
      totalSaldoUsado: totalUsado,
      totalSaldoDisponible: Math.max(0, totalLimite - totalUsado),
      utilizacionPromedio,
      saludGeneral,
      tarjetas,
    };
  }

  // ─── Recordatorios (llamado por cron) ───────────────────────────────────

  async enviarRecordatoriosPendientes(): Promise<void> {
    const hoy = new Date();
    const hoyNum = hoy.getDate();
    const mesNum = hoy.getMonth();
    const anioNum = hoy.getFullYear();

    // Traer todas las tarjetas activas con recordatorios
    const tarjetas = await this.creditCardModel
      .find({ activa: { $ne: false }, pausadaPorPlan: { $ne: true }, 'recordatorios.0': { $exists: true } })
      .select('cardId userId nombre proximaFechaCorte proximaFechaPago recordatorios')
      .lean();

    for (const card of tarjetas as any[]) {
      for (const rem of (card.recordatorios ?? []) as Array<{ tipo: string; diasAntes?: number; fecha?: string; activo: boolean }>) {
        if (!rem.activo) continue;

        // Resolver fecha objetivo: puede ser una fecha específica en el reminder,
        // o la `proximaFechaCorte` / `proximaFechaPago` según el tipo.
        let fechaEvento: Date | null = null;
        if (rem.fecha) {
          fechaEvento = new Date(rem.fecha);
        } else if (rem.tipo === 'corte') {
          fechaEvento = card.proximaFechaCorte ?? null;
        } else if (rem.tipo === 'pago') {
          fechaEvento = card.proximaFechaPago ?? null;
        } else if (rem.tipo === 'custom') {
          // custom sin fecha no hace nada
          fechaEvento = null;
        }

        if (!fechaEvento) continue;

        const diffMs = fechaEvento.getTime() - hoy.getTime();
        const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        const diasTarget = typeof rem.diasAntes === 'number' ? rem.diasAntes : null;

        // Si se configuró diasAntes, enviar cuando diffDias === diasAntes
        // Si no, para recordatorios por fecha enviar cuando diffDias === 0
        const shouldSend = diasTarget !== null ? diffDias === diasTarget : diffDias === 0;

        if (!shouldSend) continue;

        const tipoLabel = rem.tipo === 'corte' ? 'de corte' : rem.tipo === 'pago' ? 'de pago' : 'programado';
        const titulo = `Recordatorio de tarjeta: ${card.nombre}`;
        const mensaje =
          rem.tipo === 'pago'
            ? `Tu fecha ${tipoLabel} de "${card.nombre}" es en ${diffDias} día(s). ¡No olvides pagar!`
            : rem.tipo === 'corte'
            ? `El corte de tu tarjeta "${card.nombre}" es en ${diffDias} día(s).`
            : `Recordatorio programado para "${card.nombre}" en ${diffDias} día(s).`;

        try {
          await this.notificacionesService.enviarNotificacionPush(card.userId, titulo, mensaje, {
            tipo: 'credit_card_reminder',
            cardId: card.cardId,
            reminderType: rem.tipo,
            diasRestantes: diffDias,
            reminderDate: fechaEvento.toISOString(),
          });
        } catch (err) {
          this.logger.warn(`Error enviando recordatorio tarjeta ${card.cardId}: ${(err as any)?.message}`);
        }
      }
    }
  }

  /**
   * Avanza las fechas de corte/pago de las tarjetas cuya próxima fecha ya pasó.
   * Llamado por el cron diario.
   */
  async avanzarFechasCiclo(): Promise<void> {
    const ahora = new Date();
    const tarjetasVencidas = await this.creditCardModel
      .find({
        activa: { $ne: false },
        $or: [
          { proximaFechaCorte: { $lte: ahora } },
          { proximaFechaPago: { $lte: ahora } },
        ],
      })
      .lean();

    for (const card of tarjetasVencidas as any[]) {
      const updates: Partial<CreditCard> = {};
      if (card.diaCorte && card.proximaFechaCorte && new Date(card.proximaFechaCorte) <= ahora) {
        updates.proximaFechaCorte = siguienteOcurrencia(card.diaCorte);
      }
      if (card.diaPago && card.proximaFechaPago && new Date(card.proximaFechaPago) <= ahora) {
        updates.proximaFechaPago = siguienteOcurrencia(card.diaPago);
      }
      if (Object.keys(updates).length > 0) {
        await this.creditCardModel.updateOne({ cardId: card.cardId }, { $set: updates });
      }
    }
  }
}
