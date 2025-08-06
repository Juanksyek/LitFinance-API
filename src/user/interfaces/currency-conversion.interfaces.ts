export interface ConversionResult {
  message: string;
  summary: {
    monedaAnterior: string;
    monedaNueva: string;
    tasaCambio: number;
    elementosConvertidos: {
      transacciones: number;
      historialCuenta: number;
      recurrentes: number;
      cuentaPrincipal: boolean;
    };
    totalElementos: number;
  };
  conversiones: {
    tipo: string;
    elementosAfectados: number;
    detalles: any[];
  }[];
}

export interface CurrencyChangePreview {
  monedaActual: string;
  nuevaMoneda: string;
  tasaCambio: number;
  elementosAfectados: {
    cuentaPrincipal: boolean;
    transacciones: number;
    historialCuenta: number;
    recurrentes: number;
    total: number;
  };
  advertencia: string;
  reversible: boolean;
}
