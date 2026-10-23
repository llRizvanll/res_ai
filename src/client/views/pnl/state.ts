// Profit & Loss page state and data shape.
import type { AppCtx } from '../../core/types/app.js';
import { addDays, periodRange, today } from '../../core/dates.js';

export interface PnL {
  from: string;
  to: string;
  days: number;
  orders: number;
  covers: number;
  gross_sales: number;
  discounts: number;
  net_sales: number;
  service_charge: number;
  packaging: number;
  round_off: number;
  other_income: number;
  total_revenue: number;
  tax_collected: number;
  food_cost: number;
  wastage: number;
  cogs: number;
  gross_profit: number;
  gross_margin: number;
  expenses: { category: string; amount: number }[];
  total_expenses: number;
  operating_profit: number;
  net_margin: number;
  avg_order_value: number;
  food_cost_pct: number;
  cancelled_value: number;
  void_value: number;
}

export type Unit = 'month' | 'quarter' | 'year' | 'custom';
export const P = {
  root: document.createElement('div') as HTMLElement, // replaced on render; detached until then
  ctxRef: null as AppCtx | null,
  unit: 'month' as Unit,
  anchor: today(),
  custom: [addDays(today(), -29), today()] as [string, string],
  compare: 'previous' as 'previous' | 'last_year',
  year: Number(today().slice(0, 4)),
  data: null as { current: PnL; previous: PnL; last_year: PnL } | null,
};
export const range = (): [string, string] => (P.unit === 'custom' ? P.custom : periodRange(P.unit, P.anchor));
