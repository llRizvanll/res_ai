// CSV export of the P&L statement.
import { downloadCSV } from '../../core/csv.js';
import { P } from './state.js';

export function exportCSV() {
  if (!P.data) return;
  const c = P.data.current;
  const p = P.compare === 'previous' ? P.data.previous : P.data.last_year;
  const row = (l: string, a: number, b: number) => [l, a, b, b ? (((a - b) / Math.abs(b)) * 100).toFixed(1) + '%' : ''];
  downloadCSV(`profit-and-loss-${c.from}-to-${c.to}.csv`, [
    ['Line', `${c.from} to ${c.to}`, `${p.from} to ${p.to}`, 'Change'],
    row('Gross sales', c.gross_sales, p.gross_sales),
    row('Discounts', -c.discounts, -p.discounts),
    row('Net sales', c.net_sales, p.net_sales),
    row('Service charge', c.service_charge, p.service_charge),
    row('Packaging', c.packaging, p.packaging),
    row('Round-off', c.round_off, p.round_off),
    row('Total revenue (excl. GST)', c.total_revenue, p.total_revenue),
    row('Food cost', c.food_cost, p.food_cost),
    row('Wastage', c.wastage, p.wastage),
    row('Cost of goods', c.cogs, p.cogs),
    row('Gross profit', c.gross_profit, p.gross_profit),
    ...[...new Set([...c.expenses, ...p.expenses].map((e) => e.category))].map((cat) =>
      row(`Expense: ${cat}`, c.expenses.find((e) => e.category === cat)?.amount || 0, p.expenses.find((e) => e.category === cat)?.amount || 0),
    ),
    row('Total operating expenses', c.total_expenses, p.total_expenses),
    row('Net profit', c.operating_profit, p.operating_profit),
    row('GST collected (payable)', c.tax_collected, p.tax_collected),
    row('Bills', c.orders, p.orders),
  ]);
}
