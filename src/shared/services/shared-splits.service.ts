import { Injectable, BadRequestException } from '@nestjs/common';

export interface SplitCalculationInput {
  montoTotal: number;
  splitMode: string;
  members: Array<{
    memberId: string;
    userId: string;
    amountAssigned?: number;
    percentage?: number;
    units?: number;
    included?: boolean;
  }>;
}

export interface SplitCalculationResult {
  memberId: string;
  userId: string;
  amountAssigned: number;
  percentage?: number;
  units?: number;
  included: boolean;
  roleInSplit: string;
}

@Injectable()
export class SharedSplitsService {
  calculate(input: SplitCalculationInput): SplitCalculationResult[] {
    const { montoTotal, splitMode, members } = input;
    const included = members.filter((m) => m.included !== false);

    if (included.length === 0) {
      throw new BadRequestException('Debe haber al menos un miembro incluido en el split');
    }

    switch (splitMode) {
      case 'equal':
        return this.splitEqual(montoTotal, included);
      case 'percentage':
        return this.splitPercentage(montoTotal, included);
      case 'fixed':
        return this.splitFixed(montoTotal, included);
      case 'units':
        return this.splitUnits(montoTotal, included);
      case 'participants_only':
        return this.splitEqual(montoTotal, included);
      case 'custom':
        return this.splitFixed(montoTotal, included);
      default:
        throw new BadRequestException(`splitMode '${splitMode}' no soportado`);
    }
  }

  private splitEqual(montoTotal: number, members: SplitCalculationInput['members']): SplitCalculationResult[] {
    const count = members.length;
    const base = Math.floor((montoTotal / count) * 100) / 100;
    const remainder = Math.round((montoTotal - base * count) * 100) / 100;

    return members.map((m, i) => ({
      memberId: m.memberId,
      userId: m.userId,
      amountAssigned: i === 0 ? +(base + remainder).toFixed(2) : base,
      percentage: +(100 / count).toFixed(2),
      included: true,
      roleInSplit: 'participant',
    }));
  }

  private splitPercentage(montoTotal: number, members: SplitCalculationInput['members']): SplitCalculationResult[] {
    const totalPct = members.reduce((s, m) => s + (m.percentage ?? 0), 0);
    if (Math.abs(totalPct - 100) > 0.01) {
      throw new BadRequestException(`La suma de porcentajes debe ser 100. Actual: ${totalPct}`);
    }

    return members.map((m) => ({
      memberId: m.memberId,
      userId: m.userId,
      amountAssigned: +((montoTotal * (m.percentage ?? 0)) / 100).toFixed(2),
      percentage: m.percentage,
      included: true,
      roleInSplit: 'participant',
    }));
  }

  private splitFixed(montoTotal: number, members: SplitCalculationInput['members']): SplitCalculationResult[] {
    const totalAssigned = members.reduce((s, m) => s + (m.amountAssigned ?? 0), 0);
    if (Math.abs(totalAssigned - montoTotal) > 0.01) {
      throw new BadRequestException(
        `La suma de montos asignados (${totalAssigned}) debe ser igual al monto total (${montoTotal})`,
      );
    }

    return members.map((m) => ({
      memberId: m.memberId,
      userId: m.userId,
      amountAssigned: m.amountAssigned ?? 0,
      included: true,
      roleInSplit: 'participant',
    }));
  }

  private splitUnits(montoTotal: number, members: SplitCalculationInput['members']): SplitCalculationResult[] {
    const totalUnits = members.reduce((s, m) => s + (m.units ?? 1), 0);
    if (totalUnits <= 0) {
      throw new BadRequestException('Total de unidades debe ser mayor a 0');
    }

    return members.map((m) => {
      const u = m.units ?? 1;
      return {
        memberId: m.memberId,
        userId: m.userId,
        amountAssigned: +((montoTotal * u) / totalUnits).toFixed(2),
        units: u,
        included: true,
        roleInSplit: 'participant',
      };
    });
  }

  validateContributions(montoTotal: number, contributions: Array<{ amountContributed: number }>): void {
    const total = contributions.reduce((s, c) => s + c.amountContributed, 0);
    if (Math.abs(total - montoTotal) > 0.01) {
      throw new BadRequestException(
        `La suma de contribuciones (${total}) debe ser igual al monto total (${montoTotal})`,
      );
    }
  }
}
