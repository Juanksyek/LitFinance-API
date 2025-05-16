export class CrearRecurrenteDto {
  nombre: string;
  plataforma: string;
  frecuenciaDias: number;
  monto: number;
  afectaCuentaPrincipal: boolean;
  cuentaId?: string;
  subcuentaId?: string;
  afectaSubcuenta: boolean;
  userId: string;
}
