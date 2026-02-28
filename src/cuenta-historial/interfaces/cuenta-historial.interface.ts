export interface CuentaHistorial {
  _id: string;
  cuentaId: string;
  userId: string;
  monto: number;
  tipo: 'ingreso' | 'egreso' | 'ajuste_subcuenta' | 'recurrente';
  descripcion: string;
  fecha: Date;
  subcuentaId?: string;
  conceptoId?: string;
  concepto?: string;
  motivo?: string;
}
