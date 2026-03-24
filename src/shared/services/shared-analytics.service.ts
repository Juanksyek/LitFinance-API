import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SharedMovement, SharedMovementDocument } from '../schemas/shared-movement.schema';
import { SharedMovementContribution, SharedMovementContributionDocument } from '../schemas/shared-movement-contribution.schema';
import { SharedMovementSplit, SharedMovementSplitDocument } from '../schemas/shared-movement-split.schema';
import { SharedSpaceMember, SharedSpaceMemberDocument } from '../schemas/shared-space-member.schema';
import { SharedAnalyticsSnapshot, SharedAnalyticsSnapshotDocument } from '../schemas/shared-analytics-snapshot.schema';
import { generateUniqueId } from '../../utils/generate-id';

export interface PeriodRange {
  from: Date;
  to: Date;
}

@Injectable()
export class SharedAnalyticsService {
  private readonly logger = new Logger(SharedAnalyticsService.name);

  constructor(
    @InjectModel(SharedMovement.name) private readonly movementModel: Model<SharedMovementDocument>,
    @InjectModel(SharedMovementContribution.name) private readonly contributionModel: Model<SharedMovementContributionDocument>,
    @InjectModel(SharedMovementSplit.name) private readonly splitModel: Model<SharedMovementSplitDocument>,
    @InjectModel(SharedSpaceMember.name) private readonly memberModel: Model<SharedSpaceMemberDocument>,
    @InjectModel(SharedAnalyticsSnapshot.name) private readonly snapshotModel: Model<SharedAnalyticsSnapshotDocument>,
  ) {}

  async summary(spaceId: string, query?: { from?: string; to?: string }) {
    const period = this.parsePeriod(query);
    const filter: any = { spaceId, estado: { $in: ['published', 'corrected'] } };
    if (period) {
      filter.fechaMovimiento = {};
      if (period.from) filter.fechaMovimiento.$gte = period.from;
      if (period.to) filter.fechaMovimiento.$lte = period.to;
    }

    const movements = await this.movementModel.find(filter).lean();

    let totalExpenses = 0;
    let totalIncome = 0;
    let totalAdjustments = 0;
    const bySplitMode: Record<string, number> = {};
    let movementCount = movements.length;

    for (const m of movements) {
      if (m.tipo === 'expense') totalExpenses += m.montoTotal;
      else if (m.tipo === 'income') totalIncome += m.montoTotal;
      else if (m.tipo === 'adjustment') totalAdjustments += m.montoTotal;

      bySplitMode[m.splitMode] = (bySplitMode[m.splitMode] ?? 0) + 1;
    }

    return {
      spaceId,
      period: period ?? { from: null, to: null },
      movementCount,
      totalExpenses: +totalExpenses.toFixed(2),
      totalIncome: +totalIncome.toFixed(2),
      totalAdjustments: +totalAdjustments.toFixed(2),
      netAmount: +(totalIncome - totalExpenses + totalAdjustments).toFixed(2),
      bySplitMode,
    };
  }

  async byMember(spaceId: string, query?: { from?: string; to?: string }) {
    const period = this.parsePeriod(query);
    const filter: any = { spaceId, estado: { $in: ['published', 'corrected'] } };
    if (period) {
      filter.fechaMovimiento = {};
      if (period.from) filter.fechaMovimiento.$gte = period.from;
      if (period.to) filter.fechaMovimiento.$lte = period.to;
    }

    const movements = await this.movementModel.find(filter).lean();
    const movementIds = movements.map((m) => m.movementId);

    if (movementIds.length === 0) return [];

    const [contributions, splits, members] = await Promise.all([
      this.contributionModel.find({ movementId: { $in: movementIds } }).lean(),
      this.splitModel.find({ movementId: { $in: movementIds } }).lean(),
      this.memberModel.find({ spaceId, estado: 'active' }).lean(),
    ]);

    const memberStats = new Map<string, {
      memberId: string;
      userId: string;
      totalContributed: number;
      totalAssigned: number;
      movementsCreated: number;
      movementsInvolved: number;
    }>();

    // Inicializar con miembros activos
    for (const m of members) {
      memberStats.set(m.memberId, {
        memberId: m.memberId,
        userId: m.userId,
        totalContributed: 0,
        totalAssigned: 0,
        movementsCreated: 0,
        movementsInvolved: 0,
      });
    }

    // Contributions
    for (const c of contributions) {
      const s = memberStats.get(c.memberId);
      if (s) s.totalContributed += c.amountContributed;
    }

    // Splits
    const memberMovements = new Map<string, Set<string>>();
    for (const sp of splits) {
      const s = memberStats.get(sp.memberId);
      if (s) {
        s.totalAssigned += sp.amountAssigned;
        if (!memberMovements.has(sp.memberId)) memberMovements.set(sp.memberId, new Set());
        memberMovements.get(sp.memberId)!.add(sp.movementId);
      }
    }

    // Movements created
    for (const mv of movements) {
      const s = memberStats.get(mv.createdByMemberId);
      if (s) s.movementsCreated++;
    }

    // Count movements involved
    for (const [memberId, mvSet] of memberMovements) {
      const s = memberStats.get(memberId);
      if (s) s.movementsInvolved = mvSet.size;
    }

    return Array.from(memberStats.values()).map((s) => ({
      ...s,
      totalContributed: +s.totalContributed.toFixed(2),
      totalAssigned: +s.totalAssigned.toFixed(2),
      difference: +(s.totalContributed - s.totalAssigned).toFixed(2),
    }));
  }

  async byCategory(spaceId: string, query?: { from?: string; to?: string }) {
    const period = this.parsePeriod(query);
    const filter: any = { spaceId, estado: { $in: ['published', 'corrected'] } };
    if (period) {
      filter.fechaMovimiento = {};
      if (period.from) filter.fechaMovimiento.$gte = period.from;
      if (period.to) filter.fechaMovimiento.$lte = period.to;
    }

    const movements = await this.movementModel.find(filter).lean();

    const catStats = new Map<string, {
      categoryId: string;
      count: number;
      totalAmount: number;
      totalExpenses: number;
      totalIncome: number;
    }>();

    for (const m of movements) {
      const catId = m.categoriaId ?? 'sin_categoria';
      const entry = catStats.get(catId) ?? {
        categoryId: catId,
        count: 0,
        totalAmount: 0,
        totalExpenses: 0,
        totalIncome: 0,
      };
      entry.count++;
      entry.totalAmount += m.montoTotal;
      if (m.tipo === 'expense') entry.totalExpenses += m.montoTotal;
      if (m.tipo === 'income') entry.totalIncome += m.montoTotal;
      catStats.set(catId, entry);
    }

    const total = movements.reduce((acc, m) => acc + m.montoTotal, 0);

    return Array.from(catStats.values())
      .map((c) => ({
        ...c,
        totalAmount: +c.totalAmount.toFixed(2),
        totalExpenses: +c.totalExpenses.toFixed(2),
        totalIncome: +c.totalIncome.toFixed(2),
        percentage: total > 0 ? +((c.totalAmount / total) * 100).toFixed(2) : 0,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }

  async trends(spaceId: string, query?: { from?: string; to?: string; groupBy?: string }) {
    const period = this.parsePeriod(query);
    const groupBy = query?.groupBy ?? 'month';

    const filter: any = { spaceId, estado: { $in: ['published', 'corrected'] } };
    if (period) {
      filter.fechaMovimiento = {};
      if (period.from) filter.fechaMovimiento.$gte = period.from;
      if (period.to) filter.fechaMovimiento.$lte = period.to;
    }

    const movements = await this.movementModel.find(filter).sort({ fechaMovimiento: 1 }).lean();

    const buckets = new Map<string, { period: string; expenses: number; income: number; count: number }>();

    for (const m of movements) {
      const date = new Date(m.fechaMovimiento);
      let key: string;
      if (groupBy === 'week') {
        const weekStart = new Date(date);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        key = weekStart.toISOString().slice(0, 10);
      } else if (groupBy === 'day') {
        key = date.toISOString().slice(0, 10);
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      }

      const bucket = buckets.get(key) ?? { period: key, expenses: 0, income: 0, count: 0 };
      bucket.count++;
      if (m.tipo === 'expense') bucket.expenses += m.montoTotal;
      if (m.tipo === 'income') bucket.income += m.montoTotal;
      buckets.set(key, bucket);
    }

    return Array.from(buckets.values()).map((b) => ({
      ...b,
      expenses: +b.expenses.toFixed(2),
      income: +b.income.toFixed(2),
      net: +(b.income - b.expenses).toFixed(2),
    }));
  }

  async balance(spaceId: string, query?: { from?: string; to?: string }) {
    const memberData = await this.byMember(spaceId, query);

    // Calcular quién debe a quién
    const debts: Array<{
      fromMemberId: string;
      fromUserId: string;
      toMemberId: string;
      toUserId: string;
      amount: number;
    }> = [];

    const debtors = memberData
      .filter((m) => m.difference < 0)
      .map((m) => ({ ...m, remaining: Math.abs(m.difference) }))
      .sort((a, b) => b.remaining - a.remaining);

    const creditors = memberData
      .filter((m) => m.difference > 0)
      .map((m) => ({ ...m, remaining: m.difference }))
      .sort((a, b) => b.remaining - a.remaining);

    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];
      const amount = Math.min(debtor.remaining, creditor.remaining);

      if (amount > 0.01) {
        debts.push({
          fromMemberId: debtor.memberId,
          fromUserId: debtor.userId,
          toMemberId: creditor.memberId,
          toUserId: creditor.userId,
          amount: +amount.toFixed(2),
        });
      }

      debtor.remaining -= amount;
      creditor.remaining -= amount;

      if (debtor.remaining < 0.01) dIdx++;
      if (creditor.remaining < 0.01) cIdx++;
    }

    return {
      members: memberData,
      debts,
      isBalanced: debts.length === 0,
    };
  }

  async saveSnapshot(spaceId: string, periodType: 'week' | 'month' | 'quarter' | 'year') {
    const [summary, byMember, byCategory] = await Promise.all([
      this.summary(spaceId),
      this.byMember(spaceId),
      this.byCategory(spaceId),
    ]);

    const snapshotId = await generateUniqueId(this.snapshotModel, 'snapshotId');
    const now = new Date();

    const snapshot = await this.snapshotModel.create({
      snapshotId,
      spaceId,
      periodType,
      periodStart: this.getPeriodStart(now, periodType),
      periodEnd: now,
      metrics: {
        totalMovements: summary.movementCount,
        totalExpenses: summary.totalExpenses,
        totalIncome: summary.totalIncome,
        totalAdjustments: summary.totalAdjustments,
        netAmount: summary.netAmount,
        byMember,
        byCategory,
        bySplitMode: summary.bySplitMode,
      },
    });

    return snapshot.toObject();
  }

  private parsePeriod(query?: { from?: string; to?: string }): PeriodRange | null {
    if (!query?.from && !query?.to) return null;
    return {
      from: query.from ? new Date(query.from) : new Date(0),
      to: query.to ? new Date(query.to) : new Date(),
    };
  }

  private getPeriodStart(date: Date, periodType: string): Date {
    const d = new Date(date);
    switch (periodType) {
      case 'week':
        d.setDate(d.getDate() - 7);
        break;
      case 'month':
        d.setMonth(d.getMonth() - 1);
        break;
      case 'quarter':
        d.setMonth(d.getMonth() - 3);
        break;
      case 'year':
        d.setFullYear(d.getFullYear() - 1);
        break;
    }
    return d;
  }
}
