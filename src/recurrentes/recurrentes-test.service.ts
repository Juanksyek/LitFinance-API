import { Injectable, Logger } from '@nestjs/common';
import { RecurrentesService } from './recurrentes.service';
import { CuentaService } from '../cuenta/cuenta.service';
import { SubcuentaService } from '../subcuenta/subcuenta.service';
import { CuentaHistorialService } from '../cuenta-historial/cuenta-historial.service';

export interface TestResult {
  test: string;
  passed: boolean;
  detalles: string;
  datos?: any;
  error?: string;
}

@Injectable()
export class RecurrentesTestService {
  private readonly logger = new Logger(RecurrentesTestService.name);

  constructor(
    private readonly recurrentesService: RecurrentesService,
    private readonly cuentaService: CuentaService,
    private readonly subcuentaService: SubcuentaService,
    private readonly cuentaHistorialService: CuentaHistorialService,
  ) {}

  async ejecutarTestsCompletos(userId: string): Promise<{
    resumen: { total: number; exitosos: number; fallidos: number };
    tests: TestResult[];
  }> {
    const tests: TestResult[] = [];

    this.logger.log(`🧪 Iniciando tests automatizados para usuario: ${userId}`);

    // Test 1: Verificar cuenta principal existe
    tests.push(await this.testCuentaPrincipalExiste(userId));

    // Test 2: Crear recurrente que afecte cuenta principal
    const testCreacion = await this.testCrearRecurrenteCuentaPrincipal(userId);
    tests.push(testCreacion);

    let recurrenteId: string | null = null;
    if (testCreacion.passed && testCreacion.datos?.recurrenteId) {
      recurrenteId = testCreacion.datos.recurrenteId;

      // Test 3: Verificar que aparece en historial después de crear
      tests.push(await this.testHistorialCreacion(userId, recurrenteId!));

      // Test 4: Ejecutar recurrente y verificar descuento
      tests.push(await this.testEjecucionYDescuento(userId, recurrenteId!));

      // Test 5: Verificar historial después de ejecución
      tests.push(await this.testHistorialEjecucion(userId, recurrenteId!));

      // Test 6: Editar recurrente
      tests.push(await this.testEditarRecurrente(recurrenteId!));

      // Test 7: Verificar historial de edición
      tests.push(await this.testHistorialEdicion(userId, recurrenteId!));

      // Test 8: Eliminar recurrente
      tests.push(await this.testEliminarRecurrente(recurrenteId!));

      // Test 9: Verificar historial de eliminación
      tests.push(await this.testHistorialEliminacion(userId, recurrenteId!));
    }

    // Test 10: Crear recurrente con subcuenta
    tests.push(await this.testRecurrenteConSubcuenta(userId));

    // Test 11: Probar saldo insuficiente
    tests.push(await this.testSaldoInsuficiente(userId));

    const exitosos = tests.filter(t => t.passed).length;
    const fallidos = tests.filter(t => !t.passed).length;

    this.logger.log(`✅ Tests completados: ${exitosos}/${tests.length} exitosos`);

    return {
      resumen: {
        total: tests.length,
        exitosos,
        fallidos,
      },
      tests,
    };
  }

  private async testCuentaPrincipalExiste(userId: string): Promise<TestResult> {
    try {
      const cuenta = await this.cuentaService.obtenerCuentaPrincipal(userId);
      return {
        test: '1. Cuenta Principal Existe',
        passed: true,
        detalles: `Cuenta encontrada con ID: ${cuenta.id}, Saldo: ${cuenta.cantidad} ${cuenta.moneda}`,
        datos: { cuentaId: cuenta.id, saldo: cuenta.cantidad, moneda: cuenta.moneda },
      };
    } catch (error) {
      return {
        test: '1. Cuenta Principal Existe',
        passed: false,
        detalles: 'No se pudo obtener la cuenta principal',
        error: error.message,
      };
    }
  }

  private async testCrearRecurrenteCuentaPrincipal(userId: string): Promise<TestResult> {
    try {
      const recurrente = await this.recurrentesService.crear({
        nombre: 'Test Automatizado - Spotify',
        monto: 9.99,
        moneda: 'USD',
        frecuenciaTipo: 'dia_mes',
        frecuenciaValor: '1',
        afectaCuentaPrincipal: true,
        afectaSubcuenta: false,
        userId,
        plataforma: {
          nombre: 'Spotify Test',
          plataformaId: 'test',
          categoria: 'Entretenimiento',
          color: '#1DB954'
        },
      }, userId);

      return {
        test: '2. Crear Recurrente (Cuenta Principal)',
        passed: true,
        detalles: `Recurrente creado: ${recurrente.nombre} - ${recurrente.monto} ${recurrente.moneda}`,
        datos: { recurrenteId: recurrente.recurrenteId, nombre: recurrente.nombre },
      };
    } catch (error) {
      return {
        test: '2. Crear Recurrente (Cuenta Principal)',
        passed: false,
        detalles: 'Error al crear recurrente',
        error: error.message,
      };
    }
  }

  private async testHistorialCreacion(userId: string, recurrenteId: string): Promise<TestResult> {
    try {
      const cuenta = await this.cuentaService.obtenerCuentaPrincipal(userId);
      const historial = await this.cuentaHistorialService.buscarHistorial(
        cuenta.id,
        1,
        20
      );

      const registroCreacion = historial.data.find(
        item => item.tipo === 'recurrente' && 
        item.descripcion?.includes('Recurrente creado') &&
        item.descripcion?.includes('Test Automatizado - Spotify')
      );

      if (registroCreacion) {
        return {
          test: '3. Historial - Registro de Creación',
          passed: true,
          detalles: `Registro encontrado: "${registroCreacion.descripcion}"`,
          datos: { descripcion: registroCreacion.descripcion, fecha: registroCreacion.fecha },
        };
      } else {
        return {
          test: '3. Historial - Registro de Creación',
          passed: false,
          detalles: 'No se encontró el registro de creación en el historial',
        };
      }
    } catch (error) {
      return {
        test: '3. Historial - Registro de Creación',
        passed: false,
        detalles: 'Error al verificar historial',
        error: error.message,
      };
    }
  }

  private async testEjecucionYDescuento(userId: string, recurrenteId: string): Promise<TestResult> {
    try {
      const cuenta = await this.cuentaService.obtenerCuentaPrincipal(userId);
      const saldoAntes = cuenta.cantidad;

      // Ejecutar el recurrente
      await this.recurrentesService.ejecutarRecurrenteTest(recurrenteId, userId);

      // Verificar saldo después
      const cuentaDespues = await this.cuentaService.obtenerCuentaPrincipal(userId);
      const saldoDespues = cuentaDespues.cantidad;
      const diferencia = saldoAntes - saldoDespues;

      if (diferencia > 0) {
        return {
          test: '4. Ejecución y Descuento de Saldo',
          passed: true,
          detalles: `Saldo descontado correctamente. Antes: ${saldoAntes}, Después: ${saldoDespues}, Diferencia: ${diferencia}`,
          datos: { saldoAntes, saldoDespues, montoDescontado: diferencia },
        };
      } else {
        return {
          test: '4. Ejecución y Descuento de Saldo',
          passed: false,
          detalles: `No se descontó el saldo. Antes: ${saldoAntes}, Después: ${saldoDespues}`,
        };
      }
    } catch (error) {
      return {
        test: '4. Ejecución y Descuento de Saldo',
        passed: false,
        detalles: 'Error al ejecutar recurrente',
        error: error.message,
      };
    }
  }

  private async testHistorialEjecucion(userId: string, recurrenteId: string): Promise<TestResult> {
    try {
      const cuenta = await this.cuentaService.obtenerCuentaPrincipal(userId);
      const historial = await this.cuentaHistorialService.buscarHistorial(
        cuenta.id,
        1,
        20
      );

      const registroEjecucion = historial.data.find(
        item => item.tipo === 'recurrente' && 
        item.monto < 0 && // Debe ser negativo porque es un cargo
        (item.descripcion?.includes('Cargo recurrente') || item.descripcion?.includes('Test Automatizado'))
      );

      if (registroEjecucion) {
        return {
          test: '5. Historial - Registro de Ejecución',
          passed: true,
          detalles: `Registro encontrado: "${registroEjecucion.descripcion}", Monto: ${registroEjecucion.monto}`,
          datos: { 
            descripcion: registroEjecucion.descripcion, 
            monto: registroEjecucion.monto,
            fecha: registroEjecucion.fecha 
          },
        };
      } else {
        return {
          test: '5. Historial - Registro de Ejecución',
          passed: false,
          detalles: 'No se encontró el registro de ejecución con monto negativo en el historial',
        };
      }
    } catch (error) {
      return {
        test: '5. Historial - Registro de Ejecución',
        passed: false,
        detalles: 'Error al verificar historial de ejecución',
        error: error.message,
      };
    }
  }

  private async testEditarRecurrente(recurrenteId: string): Promise<TestResult> {
    try {
      const editado = await this.recurrentesService.editar(recurrenteId, {
        nombre: 'Test Automatizado - Spotify EDITADO',
        monto: 12.99,
        frecuenciaTipo: 'dia_mes',
        frecuenciaValor: '15',
      });

      return {
        test: '6. Editar Recurrente',
        passed: true,
        detalles: `Recurrente editado: ${editado.nombre}, Nuevo monto: ${editado.monto}`,
        datos: { nombre: editado.nombre, monto: editado.monto },
      };
    } catch (error) {
      return {
        test: '6. Editar Recurrente',
        passed: false,
        detalles: 'Error al editar recurrente',
        error: error.message,
      };
    }
  }

  private async testHistorialEdicion(userId: string, recurrenteId: string): Promise<TestResult> {
    try {
      const cuenta = await this.cuentaService.obtenerCuentaPrincipal(userId);
      const historial = await this.cuentaHistorialService.buscarHistorial(
        cuenta.id,
        1,
        50
      );

      const registroEdicion = historial.data.find(
        item => item.tipo === 'recurrente' && 
        item.descripcion?.includes('modificado') &&
        item.monto === 0 // Las ediciones tienen monto 0
      );

      if (registroEdicion) {
        return {
          test: '7. Historial - Registro de Edición',
          passed: true,
          detalles: `Registro encontrado: "${registroEdicion.descripcion}"`,
          datos: { descripcion: registroEdicion.descripcion },
        };
      } else {
        return {
          test: '7. Historial - Registro de Edición',
          passed: false,
          detalles: 'No se encontró el registro de edición en el historial',
        };
      }
    } catch (error) {
      return {
        test: '7. Historial - Registro de Edición',
        passed: false,
        detalles: 'Error al verificar historial de edición',
        error: error.message,
      };
    }
  }

  private async testEliminarRecurrente(recurrenteId: string): Promise<TestResult> {
    try {
      const resultado = await this.recurrentesService.eliminar(recurrenteId);

      if (resultado.eliminado) {
        return {
          test: '8. Eliminar Recurrente',
          passed: true,
          detalles: resultado.mensaje,
          datos: { recurrenteId },
        };
      } else {
        return {
          test: '8. Eliminar Recurrente',
          passed: false,
          detalles: 'El recurrente no fue eliminado',
        };
      }
    } catch (error) {
      return {
        test: '8. Eliminar Recurrente',
        passed: false,
        detalles: 'Error al eliminar recurrente',
        error: error.message,
      };
    }
  }

  private async testHistorialEliminacion(userId: string, recurrenteId: string): Promise<TestResult> {
    try {
      const cuenta = await this.cuentaService.obtenerCuentaPrincipal(userId);
      const historial = await this.cuentaHistorialService.buscarHistorial(
        cuenta.id,
        1,
        50
      );

      const registroEliminacion = historial.data.find(
        item => item.tipo === 'recurrente' && 
        item.descripcion?.includes('eliminado') &&
        item.monto === 0 // Las eliminaciones tienen monto 0
      );

      if (registroEliminacion) {
        return {
          test: '9. Historial - Registro de Eliminación',
          passed: true,
          detalles: `Registro encontrado: "${registroEliminacion.descripcion}"`,
          datos: { descripcion: registroEliminacion.descripcion },
        };
      } else {
        return {
          test: '9. Historial - Registro de Eliminación',
          passed: false,
          detalles: 'No se encontró el registro de eliminación en el historial',
        };
      }
    } catch (error) {
      return {
        test: '9. Historial - Registro de Eliminación',
        passed: false,
        detalles: 'Error al verificar historial de eliminación',
        error: error.message,
      };
    }
  }

  private async testRecurrenteConSubcuenta(userId: string): Promise<TestResult> {
    try {
      // Primero crear una subcuenta de prueba
      const subcuenta = await this.subcuentaService.crear({
        nombre: 'Test Subcuenta',
        cantidad: 100,
        moneda: 'USD',
        afectaCuenta: true,
      }, userId);

      // Crear recurrente que afecte la subcuenta
      const recurrente = await this.recurrentesService.crear({
        nombre: 'Test Automatizado - Netflix (Subcuenta)',
        monto: 15.99,
        moneda: 'USD',
        frecuenciaTipo: 'dia_mes',
        frecuenciaValor: '1',
        afectaCuentaPrincipal: false,
        afectaSubcuenta: true,
        subcuentaId: subcuenta.subCuentaId,
        userId,
        plataforma: {
          nombre: 'Netflix Test',
          plataformaId: 'test',
          categoria: 'Entretenimiento',
          color: '#E50914'
        },
      }, userId);

      // Ejecutar el recurrente
      await this.recurrentesService.ejecutarRecurrenteTest(recurrente.recurrenteId, userId);

      // Limpiar - eliminar recurrente y subcuenta
      await this.recurrentesService.eliminar(recurrente.recurrenteId);
      await this.subcuentaService.eliminar(subcuenta.subCuentaId, userId);

      return {
        test: '10. Recurrente con Subcuenta',
        passed: true,
        detalles: 'Recurrente con subcuenta creado, ejecutado y limpiado correctamente',
        datos: { subcuentaId: subcuenta.subCuentaId, recurrenteId: recurrente.recurrenteId },
      };
    } catch (error) {
      return {
        test: '10. Recurrente con Subcuenta',
        passed: false,
        detalles: 'Error en prueba con subcuenta',
        error: error.message,
      };
    }
  }

  private async testSaldoInsuficiente(userId: string): Promise<TestResult> {
    try {
      const cuenta = await this.cuentaService.obtenerCuentaPrincipal(userId);
      const montoExcesivo = cuenta.cantidad + 1000; // Monto mayor al saldo

      // Crear recurrente con monto excesivo
      const recurrente = await this.recurrentesService.crear({
        nombre: 'Test Automatizado - Saldo Insuficiente',
        monto: montoExcesivo,
        moneda: cuenta.moneda,
        frecuenciaTipo: 'dia_mes',
        frecuenciaValor: '1',
        afectaCuentaPrincipal: true,
        afectaSubcuenta: false,
        userId,
        plataforma: {
          nombre: 'Test Insuficiente',
          plataformaId: 'test',
          categoria: 'Test',
          color: '#FF0000'
        },
      }, userId);

      // Intentar ejecutar (debería fallar)
      try {
        await this.recurrentesService.ejecutarRecurrenteTest(recurrente.recurrenteId, userId);
        
        // Verificar que el recurrente tiene estado de error
        const recurrenteActualizado = await this.recurrentesService.obtenerPorId(recurrente.recurrenteId);
        
        // Limpiar
        await this.recurrentesService.eliminar(recurrente.recurrenteId);

        if (recurrenteActualizado.estado === 'error' && recurrenteActualizado.mensajeError) {
          return {
            test: '11. Manejo de Saldo Insuficiente',
            passed: true,
            detalles: `Error capturado correctamente: ${recurrenteActualizado.mensajeError}`,
            datos: { estado: recurrenteActualizado.estado, error: recurrenteActualizado.mensajeError },
          };
        } else {
          return {
            test: '11. Manejo de Saldo Insuficiente',
            passed: false,
            detalles: 'El recurrente no registró el error de saldo insuficiente',
          };
        }
      } catch (error) {
        // Limpiar en caso de error
        await this.recurrentesService.eliminar(recurrente.recurrenteId);
        throw error;
      }
    } catch (error) {
      return {
        test: '11. Manejo de Saldo Insuficiente',
        passed: false,
        detalles: 'Error en prueba de saldo insuficiente',
        error: error.message,
      };
    }
  }
}
