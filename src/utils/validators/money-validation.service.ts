import { Injectable, BadRequestException, Logger } from '@nestjs/common';

export interface MoneyValidationConfig {
  maxAmount: number;
  maxDailyTransactions: number;
  maxMonthlyAmount: number;
  suspicious: {
    singleTransactionThreshold: number;
    dailyAmountThreshold: number;
    monthlyTransactionCount: number;
  };
}

@Injectable()
export class MoneyValidationService {
  private readonly logger = new Logger(MoneyValidationService.name);
  
  // Configuración por defecto para validación de montos
  private readonly defaultConfig: MoneyValidationConfig = {
    maxAmount: 999_999_999_999, // 999 mil millones como límite absoluto
    maxDailyTransactions: 1000, // Máximo 1000 transacciones por día
    maxMonthlyAmount: 100_000_000_000, // 100 mil millones por mes
    suspicious: {
      singleTransactionThreshold: 10_000_000, // 10 millones - transacción sospechosa
      dailyAmountThreshold: 50_000_000, // 50 millones por día
      monthlyTransactionCount: 10000
    }
  };

  /**
   * Valida si un monto es aceptable
   */
  validateAmount(amount: number, context: string = 'transaction'): { isValid: boolean; warning?: string; error?: string } {
    // Verificar que sea un número válido
    if (!this.isValidNumber(amount)) {
      return {
        isValid: false,
        error: 'El monto debe ser un número válido'
      };
    }

    // Verificar límite absoluto
    if (amount > this.defaultConfig.maxAmount) {
      return {
        isValid: false,
        error: `El monto excede el límite máximo permitido de ${this.formatCurrency(this.defaultConfig.maxAmount)}`
      };
    }

    // Verificar montos negativos (excepto para contextos específicos)
    if (amount < 0 && !['adjustment', 'correction', 'currency_conversion', 'balance_conversion'].includes(context)) {
      return {
        isValid: false,
        error: 'El monto no puede ser negativo'
      };
    }

    // Verificar decimales excesivos
    if (!this.hasValidDecimals(amount)) {
      return {
        isValid: false,
        error: 'El monto no puede tener más de 2 decimales'
      };
    }

    // Verificar si es sospechoso
    let warning: string | undefined;
    if (amount >= this.defaultConfig.suspicious.singleTransactionThreshold) {
      warning = `Transacción de alto valor detectada: ${this.formatCurrency(amount)}`;
      this.logger.warn(`Transacción sospechosa detectada - Monto: ${amount} - Contexto: ${context}`);
    }

    return {
      isValid: true,
      warning
    };
  }

  /**
   * Valida múltiples montos y calcula totales
   */
  validateBulkAmounts(amounts: number[], context: string = 'bulk'): {
    isValid: boolean;
    invalidAmounts: number[];
    total: number;
    suspiciousCount: number;
    warnings: string[];
    errors: string[];
  } {
    const result = {
      isValid: true,
      invalidAmounts: [] as number[],
      total: 0,
      suspiciousCount: 0,
      warnings: [] as string[],
      errors: [] as string[]
    };

    let runningTotal = 0;

    for (const amount of amounts) {
      const validation = this.validateAmount(amount, context);
      
      if (!validation.isValid) {
        result.isValid = false;
        result.invalidAmounts.push(amount);
        if (validation.error) {
          result.errors.push(`Monto ${amount}: ${validation.error}`);
        }
        continue;
      }

      if (validation.warning) {
        result.warnings.push(validation.warning);
        result.suspiciousCount++;
      }

      runningTotal += amount;

      // Verificar si el total acumulado excede límites
      if (runningTotal > this.defaultConfig.maxMonthlyAmount) {
        result.warnings.push(`El total acumulado (${this.formatCurrency(runningTotal)}) excede el límite mensual recomendado`);
      }
    }

    result.total = runningTotal;
    return result;
  }

  /**
   * Sanitiza un monto para asegurar precisión
   */
  sanitizeAmount(amount: number): number {
    // Redondear a 2 decimales para evitar problemas de punto flotante
    return Math.round(amount * 100) / 100;
  }

  /**
   * Formatea montos grandes de manera legible
   */
  formatLargeAmount(amount: number, currency: string = 'USD'): string {
    const sanitized = this.sanitizeAmount(amount);
    
    if (sanitized >= 1_000_000_000) {
      return `${(sanitized / 1_000_000_000).toFixed(2)}B ${currency}`;
    } else if (sanitized >= 1_000_000) {
      return `${(sanitized / 1_000_000).toFixed(2)}M ${currency}`;
    } else if (sanitized >= 1_000) {
      return `${(sanitized / 1_000).toFixed(2)}K ${currency}`;
    } else {
      return `${sanitized.toFixed(2)} ${currency}`;
    }
  }

  /**
   * Detecta patrones sospechosos en una serie de transacciones
   */
  detectSuspiciousPatterns(amounts: number[], timestamps: Date[]): {
    hasSuspiciousPattern: boolean;
    patterns: string[];
    riskLevel: 'low' | 'medium' | 'high';
  } {
    const patterns: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    // Patrón 1: Múltiples transacciones idénticas
    const amountCounts = new Map<number, number>();
    amounts.forEach(amount => {
      const count = amountCounts.get(amount) || 0;
      amountCounts.set(amount, count + 1);
    });

    for (const [amount, count] of amountCounts.entries()) {
      if (count >= 10) {
        patterns.push(`${count} transacciones idénticas de ${this.formatCurrency(amount)}`);
        riskLevel = 'medium';
      }
    }

    // Patrón 2: Transacciones muy grandes
    const largeTransactions = amounts.filter(a => a >= this.defaultConfig.suspicious.singleTransactionThreshold);
    if (largeTransactions.length > 0) {
      patterns.push(`${largeTransactions.length} transacciones de alto valor detectadas`);
      riskLevel = largeTransactions.length > 5 ? 'high' : 'medium';
    }

    // Patrón 3: Volumen diario excesivo
    const dailyTotals = this.calculateDailyTotals(amounts, timestamps);
    const suspiciousDays = dailyTotals.filter(total => total >= this.defaultConfig.suspicious.dailyAmountThreshold);
    
    if (suspiciousDays.length > 0) {
      patterns.push(`${suspiciousDays.length} días con volumen excesivo detectados`);
      riskLevel = 'high';
    }

    return {
      hasSuspiciousPattern: patterns.length > 0,
      patterns,
      riskLevel
    };
  }

  // Métodos privados de apoyo

  private isValidNumber(value: number): boolean {
    return typeof value === 'number' && 
           !isNaN(value) && 
           isFinite(value);
  }

  private hasValidDecimals(amount: number): boolean {
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    return decimalPlaces <= 2;
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  private calculateDailyTotals(amounts: number[], timestamps: Date[]): number[] {
    const dailyMap = new Map<string, number>();
    
    amounts.forEach((amount, index) => {
      const date = timestamps[index];
      const dateKey = date.toISOString().split('T')[0];
      const currentTotal = dailyMap.get(dateKey) || 0;
      dailyMap.set(dateKey, currentTotal + amount);
    });

    return Array.from(dailyMap.values());
  }
}

/**
 * Decorator personalizado para validar montos en DTOs
 */
export function IsValidAmount(validationOptions?: any) {
  return function (object: any, propertyName: string) {
    // Implementación del decorator personalizado
    // Se puede usar con class-validator
  };
}
