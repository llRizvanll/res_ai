// Profit & loss statements from bills, stock movements and expenses.
import { all, get } from '../../db/index.js';
import { r2 } from '../../../shared/calc.js';
import { daysBetween, monthEnd } from './calendar.js';

/** Completed bills closed within a date range */
export const W = "o.status='completed' AND date(o.closed_at) BETWEEN ? AND ?";
// Cost recorded at the time of the movement; older rows without it fall back to today's unit cost
const COST = 'COALESCE(NULLIF(m.cost, 0), i.cost)';

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

const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : 0);

export function pnl(from: string, to: string): PnL {
  const s = get(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(guests),0) AS covers, COALESCE(SUM(subtotal),0) AS gross, COALESCE(SUM(discount),0) AS discount,
      COALESCE(SUM(service_charge),0) AS sc, COALESCE(SUM(packaging),0) AS pk, COALESCE(SUM(round_off),0) AS ro,
      COALESCE(SUM(tax),0) AS tax, COALESCE(SUM(total),0) AS total
     FROM orders o WHERE ${W}`,
    from, to,
  )!;
  const cost = (type: string) =>
    get(
      `SELECT COALESCE(SUM(-m.qty * ${COST}),0) AS v FROM stock_moves m JOIN inventory i ON i.id=m.inventory_id
       WHERE m.type=? AND date(m.created_at) BETWEEN ? AND ?`,
      type, from, to,
    )!.v;
  const expenses = all('SELECT COALESCE(category,\'Other\') AS category, SUM(amount) AS amount FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC', from, to)
    .map((e) => ({ category: e.category as string, amount: r2(e.amount) }));
  const net = r2(s.gross - s.discount);
  const other = r2(s.sc + s.pk + s.ro);
  const revenue = r2(net + other);
  const food = r2(cost('consumption'));
  const wastage = r2(cost('wastage'));
  const cogs = r2(food + wastage);
  const gp = r2(revenue - cogs);
  const totalExp = r2(expenses.reduce((a, e) => a + e.amount, 0));
  const op = r2(gp - totalExp);
  return {
    from, to, days: daysBetween(from, to) + 1, orders: s.orders, covers: s.covers,
    gross_sales: r2(s.gross), discounts: r2(s.discount), net_sales: net, service_charge: r2(s.sc), packaging: r2(s.pk), round_off: r2(s.ro),
    other_income: other, total_revenue: revenue, tax_collected: r2(s.tax),
    food_cost: food, wastage, cogs, gross_profit: gp, gross_margin: pct(gp, revenue),
    expenses, total_expenses: totalExp, operating_profit: op, net_margin: pct(op, revenue),
    avg_order_value: s.orders ? r2(s.total / s.orders) : 0, food_cost_pct: pct(food, net),
    cancelled_value: r2(get(`SELECT COALESCE(SUM(total),0) AS v FROM orders o WHERE status='cancelled' AND date(created_at) BETWEEN ? AND ?`, from, to)!.v),
    void_value: r2(get(`SELECT COALESCE(SUM(oi.qty*oi.price),0) AS v FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.cancelled=1 AND date(o.created_at) BETWEEN ? AND ?`, from, to)!.v),
  };
}

/** P&L for each month of a year (months after `today` are left empty) */
export function pnlByMonth(year: number, today: string) {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const start = `${year}-${String(m).padStart(2, '0')}-01`;
    if (start > today) {
      months.push(null);
      continue;
    }
    const end = monthEnd(start);
    months.push(pnl(start, end < today ? end : today));
  }
  return months;
}
