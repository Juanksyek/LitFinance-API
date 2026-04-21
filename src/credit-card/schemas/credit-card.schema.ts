import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CreditCardDocument = CreditCard & Document;

/**
 * Una entrada de movimiento registrado en la tarjeta.
 * Se guarda embebida para lecturas rápidas del dashboard.
 */
@Schema({ _id: false })
export class CreditCardMovement {
  @Prop({ required: true })
  movementId!: string;

  @Prop({ required: true })
  tipo!: 'compra' | 'pago' | 'credito' | 'ajuste';

  @Prop({ required: true })
  monto!: number;

  @Prop({ required: true })
  moneda!: string;

  /** Se guarda el convertido si difiere de la moneda de la tarjeta */
  @Prop()
  montoConvertido?: number;

  @Prop()
  tasaConversion?: number;

  @Prop({ required: true })
  descripcion!: string;

  @Prop()
  concepto?: string;

  @Prop({ required: true })
  fecha!: Date;

  @Prop()
  transaccionId?: string;

  @Prop({ default: () => new Date() })
  registradoEn!: Date;
}

const CreditCardMovementSchema = SchemaFactory.createForClass(CreditCardMovement);

/**
 * Recordatorio configurado por el usuario para esta tarjeta.
 * diasAntes: días antes de la fechaCorte o fechaPago para enviar notificación.
 */
@Schema({ _id: false })
export class CreditCardReminder {
  @Prop({ required: true, enum: ['corte', 'pago', 'custom'] })
  tipo!: 'corte' | 'pago' | 'custom';

  /** Días antes del evento (opcional si se usa `fecha`) */
  @Prop()
  diasAntes?: number;

  /** Fecha específica para recordatorio (opcional). Si se provee, puede usarse directamente o combinado con `diasAntes`. */
  @Prop()
  fecha?: Date;

  @Prop({ default: true })
  activo!: boolean;
}

const CreditCardReminderSchema = SchemaFactory.createForClass(CreditCardReminder);

@Schema({ timestamps: true })
export class CreditCard {
  /** ID publico (base62) */
  @Prop({ required: true, unique: true, index: true })
  cardId!: string;

  @Prop({ required: true })
  userId!: string;

  /** Alias / nombre visible para el usuario */
  @Prop({ required: true })
  nombre!: string;

  /** Últimos 4 dígitos (solo para identificación visual) */
  @Prop()
  last4?: string;

  /** Emisor: VISA, Mastercard, AMEX, etc. */
  @Prop()
  emisor?: string;

  /** Banco emisor */
  @Prop()
  banco?: string;

  /** Color del card en la UI (hex) */
  @Prop({ default: '#6366F1' })
  color!: string;

  /** Moneda del límite/saldo (ISO-4217) */
  @Prop({ required: true, default: 'MXN' })
  moneda!: string;

  // ── Crédito ──────────────────────────────────────────────────────────────

  /** Límite de crédito total */
  @Prop({ required: true, default: 0 })
  limiteCredito!: number;

  /** Monto usado / saldo al corte - calculado a partir de movimientos */
  @Prop({ default: 0 })
  saldoUsado!: number;

  /** Saldo disponible = limiteCredito - saldoUsado */
  @Prop({ default: 0 })
  saldoDisponible!: number;

  // ── Fechas de ciclo ───────────────────────────────────────────────────────

  /** Día del mes en que cierra el corte (1–31) */
  @Prop()
  diaCorte?: number;

  /** Día del mes en que vence el pago (1–31) */
  @Prop()
  diaPago?: number;

  /** Próxima fecha de corte calculada */
  @Prop()
  proximaFechaCorte?: Date;

  /** Próxima fecha límite de pago */
  @Prop()
  proximaFechaPago?: Date;

  // ── Pago mínimo ───────────────────────────────────────────────────────────

  /** Porcentaje de pago mínimo (0-100) */
  @Prop({ default: 5 })
  porcentajePagoMinimo!: number;

  /** Pago mínimo calculado (limiteUsado * porcentajePagoMinimo / 100) */
  @Prop({ default: 0 })
  pagoMinimo!: number;

  // ── Estado ─────────────────────────────────────────────────────────────

  @Prop({ default: true })
  activa!: boolean;

  /** Pausada automáticamente por límite de plan */
  @Prop({ default: false })
  pausadaPorPlan!: boolean;

  // ── Recordatorios ──────────────────────────────────────────────────────

  @Prop({ type: [CreditCardReminderSchema], default: [] })
  recordatorios!: CreditCardReminder[];

  // ── Movimientos embebidos (últimos N para dashboard rápido) ─────────────

  @Prop({ type: [CreditCardMovementSchema], default: [] })
  movimientosRecientes!: CreditCardMovement[];

  // ── Salud financiera ───────────────────────────────────────────────────

  /**
   * Porcentaje de utilización del crédito (saldoUsado / limiteCredito * 100).
   * Se recalcula en cada movimiento.
   * Semáforo: 0-30 = verde, 31-70 = amarillo, 71+ = rojo.
   */
  @Prop({ default: 0 })
  utilizacion!: number;

  /**
   * Puntuación de salud (0-100).
   * 100 = sin deuda. Se degrada por utilización alta, pagos tardíos, etc.
   */
  @Prop({ default: 100 })
  saludScore!: number;

  /** Etiqueta de salud: 'excelente' | 'buena' | 'regular' | 'critica' */
  @Prop({ default: 'excelente' })
  saludLabel!: string;
}

export const CreditCardSchema = SchemaFactory.createForClass(CreditCard);

// Índices
CreditCardSchema.index({ userId: 1 });
CreditCardSchema.index({ userId: 1, activa: 1 });
