export interface ResumenFinanciero {
  totalIngresado: {
    monto: number;
    moneda: string;
    desglosePorMoneda: Array<{
      moneda: string;
      monto: number;
      simbolo: string;
    }>;
  };
  
  totalGastado: {
    monto: number;
    moneda: string;
    desglosePorMoneda: Array<{
      moneda: string;
      monto: number;
      simbolo: string;
    }>;
  };
  
  balance: {
    monto: number;
    moneda: string;
    esPositivo: boolean;
  };
  
  totalEnSubcuentas: {
    monto: number;
    moneda: string;
    desglosePorSubcuenta: Array<{
      subcuentaId: string;
      nombre: string;
      monto: number;
      moneda: string;
      simbolo: string;
      activa: boolean;
    }>;
  };
  
  totalMovimientos: number;
  periodo: {
    fechaInicio: Date;
    fechaFin: Date;
    descripcion: string;
  };
}

export interface EstadisticasPorConcepto {
  concepto: {
    id: string;
    nombre: string;
    color?: string;
    icono?: string;
  };
  totalIngreso: number;
  totalGasto: number;
  cantidadMovimientos: number;
  montoPromedio: number;
  ultimoMovimiento: Date;
  participacionPorcentual: number;
}

export interface EstadisticasPorSubcuenta {
  subcuenta: {
    id: string;
    nombre: string;
    color?: string;
    moneda: string;
    simbolo: string;
    activa: boolean;
  };
  saldoActual: number;
  totalIngresos: number;
  totalEgresos: number;
  cantidadMovimientos: number;
  ultimoMovimiento?: Date;
  crecimientoMensual: number;
}

export interface EstadisticasPorRecurrente {
  recurrente: {
    id: string;
    nombre: string;
    plataforma: {
      nombre: string;
      color: string;
      categoria: string;
    };
    frecuencia: string;
  };
  montoMensual: number;
  totalEjecutado: number;
  ultimaEjecucion?: Date;
  proximaEjecucion: Date;
  estadoActual: 'activo' | 'pausado';
  cantidadEjecuciones: number;
}

export interface AnalisisTemporalData {
  fecha: string;
  ingresos: number;
  gastos: number;
  balance: number;
  cantidadMovimientos: number;
}

export interface AnalisisTemporal {
  periodoAnalisis: 'diario' | 'semanal' | 'mensual';
  datos: AnalisisTemporalData[];
  // Shape adicional para compatibilidad con UI (ExpensesChart):
  // - `range` usa los valores del filtro (dia/semana/mes/3meses/6meses/año/personalizado)
  // - `points` usa `{ x, in, out }` donde `out` es negativo
  range?: 'dia' | 'semana' | 'mes' | '3meses' | '6meses' | 'año' | 'personalizado' | 'desdeSiempre';
  points?: Array<{ x: string; in: number; out: number }>;
  tendencias: {
    ingresosTendencia: 'ascendente' | 'descendente' | 'estable';
    gastosTendencia: 'ascendente' | 'descendente' | 'estable';
    balanceTendencia: 'ascendente' | 'descendente' | 'estable';
  };
  promedios: {
    ingresoPromedio: number;
    gastoPromedio: number;
    balancePromedio: number;
  };
}

export interface MovimientoDetallado {
  id: string;
  tipo: 'ingreso' | 'egreso' | 'transferencia' | 'recurrente';
  fecha: Date;
  monto: number;
  moneda: string;
  simbolo: string;
  descripcion: string;
  concepto?: {
    id: string;
    nombre: string;
    color?: string;
  };
  subcuenta?: {
    id: string;
    nombre: string;
  };
  cuenta?: {
    id: string;
    nombre: string;
  };
  esRecurrente: boolean;
  metadata?: any;
}

export interface MovimientosResponse {
  movimientos: MovimientoDetallado[];
  paginacion: {
    paginaActual: number;
    totalPaginas: number;
    totalElementos: number;
    elementosPorPagina: number;
  };
  filtrosAplicados: any;
  resumenPagina: {
    totalIngresos: number;
    totalGastos: number;
    balance: number;
  };
}

export interface ComparacionPeriodos {
  periodoActual: {
    fechaInicio: Date;
    fechaFin: Date;
    ingresos: number;
    gastos: number;
    balance: number;
    movimientos: number;
  };
  periodoAnterior: {
    fechaInicio: Date;
    fechaFin: Date;
    ingresos: number;
    gastos: number;
    balance: number;
    movimientos: number;
  };
  cambios: {
    ingresos: {
      absoluto: number;
      porcentual: number;
    };
    gastos: {
      absoluto: number;
      porcentual: number;
    };
    balance: {
      absoluto: number;
      porcentual: number;
    };
    movimientos: {
      absoluto: number;
      porcentual: number;
    };
  };
}

export type InsightSeverity = 'info' | 'warning' | 'success';

export interface Insight {
  codigo: string;
  severidad: InsightSeverity;
  titulo: string;
  detalle: string;
  metadata?: any;
}

export interface SerieMensualItem {
  mes: string; // YYYY-MM
  ingresos: number;
  gastos: number; // Incluye recurrentes si se solicitó
  gastosRecurrentes: number;
  balance: number;
  movimientos: number;
}

export interface TopConceptoGastoItem {
  conceptoId: string;
  nombre: string;
  monto: number;
  cantidadMovimientos: number;
  deltaVsPeriodoAnterior: number;
  participacionPorcentual: number;
  color?: string;
  icono?: string;
}

export interface TopRecurrenteItem {
  recurrenteId: string;
  nombre: string;
  plataforma?: {
    plataformaId: string;
    nombre: string;
    color: string;
    categoria: string;
  };
  totalEjecutado: number;
  cantidadEjecuciones: number;
}

export interface ResumenInteligente {
  periodo: {
    fechaInicio: Date;
    fechaFin: Date;
    descripcion: string;
  };
  moneda: string;
  totales: {
    ingresos: number;
    gastos: number;
    balance: number;
    movimientos: number;
  };
  serieMensual: SerieMensualItem[];
  topConceptosGasto: TopConceptoGastoItem[];
  recurrentes: {
    totalEjecutado: number;
    top: TopRecurrenteItem[];
  };
  insights: Insight[];
}
