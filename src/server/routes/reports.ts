// Dashboard numbers and the sales report.
import { fail, MGR, FRONT, api } from '../core/http.js';
import { todayStr } from '../core/util.js';
import { dateOpt } from '../core/validate.js';
import { all, get } from '../db/index.js';
import { paymentSplit } from '../services/orders.js';
import { r2 } from '../../shared/calc.js';

api.get('/api/dashboard', FRONT, () => {
  const dayStats = (offset: number) =>
    get(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(guests),0) AS guests FROM orders
       WHERE status='completed' AND date(closed_at)=date('now','localtime',?)`,
      `${offset} day`,
    );
  const W = "status='completed' AND date(closed_at)=date('now','localtime')";
  return {
    today: dayStats(0),
    yesterday: dayStats(-1),
    running: get("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS value FROM orders WHERE status='open'"),
    tables: get("SELECT COUNT(*) AS total, (SELECT COUNT(DISTINCT table_id) FROM orders WHERE status='open' AND table_id IS NOT NULL) AS occupied FROM dining_tables"),
    kots: get("SELECT COUNT(*) AS n FROM kots k JOIN orders o ON o.id=k.order_id WHERE k.status IN ('new','preparing') AND o.status!='cancelled'")!.n,
    last7: all(
      `SELECT date(closed_at) AS day, SUM(total) AS sales, COUNT(*) AS orders FROM orders
       WHERE status='completed' AND date(closed_at) >= date('now','localtime','-6 day') GROUP BY day ORDER BY day`,
    ),
    topItems: all(
      `SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.qty*oi.price) AS amount FROM order_items oi JOIN orders o ON o.id=oi.order_id
       WHERE o.${W.replace('date(closed_at)', 'date(o.closed_at)')} AND oi.cancelled=0 GROUP BY oi.name ORDER BY qty DESC LIMIT 6`,
    ),
    payments: paymentSplit(all(`SELECT payment_mode, payments, total FROM orders WHERE ${W}`)),
    byType: all(`SELECT type, COUNT(*) AS orders, SUM(total) AS sales FROM orders WHERE ${W} GROUP BY type`),
    lowStock: all('SELECT * FROM inventory WHERE stock <= min_stock ORDER BY (stock - min_stock) LIMIT 8'),
    reservations: all(
      `SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN dining_tables t ON t.id=r.table_id
       WHERE r.date=date('now','localtime') AND r.status='booked' ORDER BY r.time`,
    ),
    recent: all(
      `SELECT o.id, o.order_no, o.type, o.status, o.total, o.created_at, t.name AS table_name FROM orders o
       LEFT JOIN dining_tables t ON t.id=o.table_id ORDER BY o.id DESC LIMIT 8`,
    ),
  };
});


api.get('/api/reports', MGR, ({ query }) => {
  const from = dateOpt(query.from, 'From date') || todayStr();
  const to = dateOpt(query.to, 'To date') || from;
  if (to < from) fail(400, '“To” date must be on or after the “From” date');
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 366) fail(400, 'Choose a range of one year or less');
  const W = "o.status='completed' AND date(o.closed_at) BETWEEN ? AND ?";
  const items = all(
    `SELECT oi.name, COALESCE(c.name,'Uncategorised') AS category, SUM(oi.qty) AS qty, SUM(oi.qty*oi.price) AS amount
     FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN items i ON i.id=oi.item_id LEFT JOIN categories c ON c.id=i.category_id
     WHERE ${W} AND oi.cancelled=0 GROUP BY oi.name, category ORDER BY amount DESC`,
    from, to,
  );
  const cats: Record<string, { category: string; qty: number; amount: number }> = {};
  for (const i of items) {
    cats[i.category] ??= { category: i.category, qty: 0, amount: 0 };
    cats[i.category].qty += i.qty;
    cats[i.category].amount += i.amount;
  }
  const cost = (type: string): number =>
    get(
      `SELECT COALESCE(SUM(-m.qty * i.cost),0) AS v FROM stock_moves m JOIN inventory i ON i.id=m.inventory_id
       WHERE m.type=? AND date(m.created_at) BETWEEN ? AND ?`,
      type, from, to,
    )!.v;
  return {
    from,
    to,
    summary: get(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(subtotal),0) AS gross, COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(tax),0) AS tax,
        COALESCE(SUM(service_charge),0) AS service_charge, COALESCE(SUM(packaging),0) AS packaging, COALESCE(SUM(round_off),0) AS round_off,
        COALESCE(SUM(total),0) AS total, COALESCE(SUM(guests),0) AS guests FROM orders o WHERE ${W}`,
      from, to,
    ),
    cancelled: get(
      "SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS value FROM orders o WHERE o.status='cancelled' AND date(o.created_at) BETWEEN ? AND ?",
      from, to,
    ),
    voids: get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(oi.qty*oi.price),0) AS value FROM order_items oi JOIN orders o ON o.id=oi.order_id
       WHERE oi.cancelled=1 AND date(o.created_at) BETWEEN ? AND ?`,
      from, to,
    ),
    daily: all(`SELECT date(o.closed_at) AS day, COUNT(*) AS orders, SUM(total) AS sales FROM orders o WHERE ${W} GROUP BY day ORDER BY day`, from, to),
    hourly: all(
      `SELECT CAST(strftime('%H', o.created_at) AS INTEGER) AS hour, COUNT(*) AS orders, SUM(total) AS sales FROM orders o
       WHERE ${W} GROUP BY hour ORDER BY hour`,
      from, to,
    ),
    byType: all(`SELECT type, COUNT(*) AS orders, SUM(total) AS sales FROM orders o WHERE ${W} GROUP BY type ORDER BY sales DESC`, from, to),
    payments: paymentSplit(all(`SELECT payment_mode, payments, total FROM orders o WHERE ${W}`, from, to)),
    items,
    categories: Object.values(cats).sort((a, b) => b.amount - a.amount),
    staff: all(
      `SELECT COALESCE(u.name,'—') AS name, COUNT(*) AS orders, SUM(o.total) AS sales FROM orders o LEFT JOIN users u ON u.id=o.created_by
       WHERE ${W} GROUP BY o.created_by ORDER BY sales DESC`,
      from, to,
    ),
    topCustomers: all(
      `SELECT c.name, c.phone, COUNT(*) AS orders, SUM(o.total) AS spent FROM orders o JOIN customers c ON c.id=o.customer_id
       WHERE ${W} GROUP BY c.id ORDER BY spent DESC LIMIT 10`,
      from, to,
    ),
    expenses: all(
      'SELECT category, SUM(amount) AS amount, COUNT(*) AS n FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC',
      from, to,
    ),
    foodCost: r2(cost('consumption')),
    wastage: r2(cost('wastage')),
    purchases: r2(
      get(
        "SELECT COALESCE(SUM(qty*cost),0) AS v FROM stock_moves WHERE type='purchase' AND date(created_at) BETWEEN ? AND ?",
        from, to,
      )!.v,
    ),
  };
});
