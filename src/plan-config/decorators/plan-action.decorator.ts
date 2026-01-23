import { SetMetadata } from '@nestjs/common';

export const PLAN_ACTION_KEY = 'planAction';

export type PlanActionType = 'transaction' | 'recurrente' | 'subcuenta' | 'grafica';

export const PlanAction = (action: PlanActionType) => SetMetadata(PLAN_ACTION_KEY, action);
