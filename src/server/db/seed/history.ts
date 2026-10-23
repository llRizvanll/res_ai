// Generates 30 days of realistic demo activity: bills, expenses, purchases, reservations, running tables.
import { all, get, run, getSettings, type Row } from '../query.js';
import { computeTotals, type CalcLine } from '../../../shared/calc.js';

const rand = (a: number, b: number): number => Math.floor(Math.random() * (b - a + 1)) + a;

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

const pad = (n: number): string => String(n).padStart(2, '0');

const fmt = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const fmtDay = (d: Date): string => fmt(d).slice(0, 10);

export function seedDemoActivity() {
  const settings = getSettings();
  const items: Row[] = all('SELECT * FROM items').map((i) => ({ ...i, variants: JSON.parse(i.variants) }));
  const tables = all('SELECT id FROM dining_tables');
  const customers = all('SELECT id FROM customers');
  const staff = all("SELECT id FROM users WHERE role IN ('admin','manager','cashier','waiter')");
  const recipes = all('SELECT * FROM recipes');
  const now = new Date();

  const makeLines = () => {
    const lines: Row[] = [];
    for (let k = rand(1, 5); k > 0; k--) {
      const it = pick(items);
      const v: Row | null = it.variants.length ? pick<Row>(it.variants) : null;
      lines.push({ item_id: it.id, name: it.name, variant: v?.name ?? null, price: v ? v.price : it.price, qty: rand(1, 2), tax_rate: it.tax_rate });
    }
    return lines;
  };

  for (let back = 30; back >= 0; back--) {
    const day = new Date(now);
    day.setDate(now.getDate() - back);
    const weekend = [0, 5, 6].includes(day.getDay());
    const count = weekend ? rand(30, 44) : rand(18, 30);

    for (let n = 0; n < count; n++) {
      const t = new Date(day);
      t.setHours(pick([12, 12, 13, 13, 13, 14, 14, 15, 16, 17, 18, 19, 19, 20, 20, 20, 21, 21, 22]), rand(0, 59), rand(0, 59));
      if (t >= now) continue;
      const r = Math.random();
      const type = r < 0.6 ? 'dine_in' : r < 0.85 ? 'takeaway' : 'delivery';
      const lines = makeLines();
      const disc = Math.random() < 0.1 ? { discount_type: 'percent', discount_value: pick([5, 10, 15]) } : { discount_type: 'flat', discount_value: 0 };
      const tot = computeTotals(lines as CalcLine[], { type, ...disc }, settings);
      const cust = Math.random() < 0.45 ? pick(customers).id : null;
      let closed = new Date(t.getTime() + rand(20, 75) * 60000);
      if (closed > now) closed = new Date(Math.max(t.getTime(), now.getTime() - 60000));
      const cancelled = Math.random() < 0.02;
      const mode = pick(['cash', 'cash', 'upi', 'upi', 'upi', 'card', 'card']);
      const by = pick(staff).id;

      const id = run(
        `INSERT INTO orders (type, table_id, customer_id, guests, status, bill_printed, subtotal, discount_type, discount_value, discount,
          tax, service_charge, packaging, round_off, total, payment_mode, payments, created_by, settled_by, created_at, closed_at, cancel_reason)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        type, type === 'dine_in' ? pick(tables).id : null, cust, type === 'dine_in' ? rand(1, 6) : 0,
        cancelled ? 'cancelled' : 'completed', 1, tot.subtotal, disc.discount_type, disc.discount_value, tot.discount,
        tot.tax, tot.service_charge, tot.packaging, tot.round_off, tot.total,
        cancelled ? null : mode, cancelled ? null : JSON.stringify([{ mode, amount: tot.total }]),
        by, cancelled ? null : by, fmt(t), fmt(closed), cancelled ? 'Customer left' : null,
      ).id;
      run('UPDATE orders SET order_no=? WHERE id=?', `${settings.invoice_prefix}-${String(id).padStart(5, '0')}`, id);
      for (const l of lines) {
        run(
          'INSERT INTO order_items (order_id, item_id, name, variant, price, qty, tax_rate, created_at) VALUES (?,?,?,?,?,?,?,?)',
          id, l.item_id, l.name, l.variant, l.price, l.qty, l.tax_rate, fmt(t),
        );
        if (cancelled) continue;
        // Historic consumption is logged for food-cost reports without changing today's opening stock
        for (const rec of recipes.filter((x) => x.item_id === l.item_id)) {
          run(
            "INSERT INTO stock_moves (inventory_id, type, qty, order_id, note, created_at) VALUES (?, 'consumption', ?, ?, 'Demo history', ?)",
            rec.inventory_id, -rec.qty * l.qty, id, fmt(closed),
          );
        }
      }
      if (cust && !cancelled) {
        run(
          'UPDATE customers SET total_spent=total_spent+?, visits=visits+1, points=points+?, last_visit=? WHERE id=?',
          tot.total, Math.floor((tot.total / 100) * Number(settings.loyalty_rate || 0)), fmt(closed), cust,
        );
      }
    }
  }

  // Expenses
  const expense = (back: number, category: string, amount: number, paid_to: string, note: string) => {
    const d = new Date(now);
    d.setDate(now.getDate() - back);
    run('INSERT INTO expenses (date, category, amount, paid_to, note) VALUES (?,?,?,?,?)', fmtDay(d), category, amount, paid_to, note);
  };
  expense(28, 'Rent', 45000, 'Landlord', 'Monthly rent');
  expense(27, 'Salaries', 92000, 'Staff', 'Monthly payroll');
  expense(20, 'Utilities', 8600, 'BESCOM', 'Electricity bill');
  expense(18, 'Utilities', 3200, 'Gas agency', 'Commercial LPG cylinders');
  expense(12, 'Maintenance', 2500, 'Cool Air Services', 'AC servicing');
  expense(9, 'Marketing', 4000, 'Print shop', 'Menu leaflets');
  for (let b = 30; b >= 0; b -= 3) expense(b, 'Groceries & Vegetables', rand(2500, 6500), 'Local market', 'Fresh produce');
  expense(1, 'Utilities', 1199, 'Internet provider', 'Broadband');

  // The monthly bills above repeat; templates continue them from next month without duplicating
  const recurring = (back: number, category: string, amount: number, paid_to: string, note: string) => {
    const d = new Date(now);
    d.setDate(now.getDate() - back);
    const start = fmtDay(d);
    const next = new Date(d);
    next.setMonth(d.getMonth() + 1);
    run(
      "INSERT INTO recurring_expenses (category, amount, paid_to, note, frequency, start_date, next_date) VALUES (?,?,?,?,'monthly',?,?)",
      category, amount, paid_to, note, start, fmtDay(next),
    );
    run('UPDATE expenses SET recurring_id=last_insert_rowid() WHERE date=? AND category=? AND amount=?', start, category, amount);
  };
  recurring(28, 'Rent', 45000, 'Landlord', 'Monthly rent');
  recurring(27, 'Salaries', 92000, 'Staff', 'Monthly payroll');
  recurring(1, 'Utilities', 1199, 'Internet provider', 'Broadband');

  // Purchases this week
  const inv = all('SELECT * FROM inventory');
  for (const name of ['Chicken', 'Paneer', 'Onion', 'Milk']) {
    const it = inv.find((i) => i.name === name)!;
    const d = new Date(now);
    d.setDate(now.getDate() - rand(1, 5));
    run(
      "INSERT INTO stock_moves (inventory_id, type, qty, cost, supplier, note, created_at) VALUES (?, 'purchase', ?, ?, ?, ?, ?)",
      it.id, rand(5, 15), it.cost, pick(['Fresh Farms Supply', 'Metro Wholesale', 'Daily Dairy']), 'Weekly purchase', fmt(d),
    );
  }

  // Reservations
  const today = fmtDay(now);
  const tomorrow = fmtDay(new Date(now.getTime() + 86400000));
  const tbl = (name: string): number | null => get('SELECT id FROM dining_tables WHERE name=?', name)?.id ?? null;
  run('INSERT INTO reservations (name, phone, guests, date, time, table_id, notes) VALUES (?,?,?,?,?,?,?)', 'Priya Nair', '9820022222', 4, today, '19:30', tbl('T7'), 'Anniversary — window seat');
  run('INSERT INTO reservations (name, phone, guests, date, time, table_id, notes) VALUES (?,?,?,?,?,?,?)', 'Corporate lunch (Infra Ltd)', '9900011122', 8, tomorrow, '13:00', tbl('R5'), 'Needs projector-free quiet corner');
  run('INSERT INTO reservations (name, phone, guests, date, time, table_id, notes) VALUES (?,?,?,?,?,?,?)', 'Rohan Gupta', '9830033333', 2, today, '21:00', null, null);

  // A couple of running tables so the floor and kitchen screens have live data
  const waiter = get("SELECT id FROM users WHERE username='waiter'")!.id;
  const live: [string, number, number, string, [string, string | null, number][]][] = [
    ['T2', 3, 25, 'preparing', [['Paneer Tikka', 'Full', 1], ['Butter Naan', null, 4], ['Dal Makhani', null, 1], ['Mango Lassi', null, 2]]],
    ['T5', 2, 8, 'new', [['Chicken Biryani', 'Regular', 2], ['Chicken 65', null, 1], ['Soft Drink', null, 2]]],
  ];
  for (const [tableName, guests, minsAgo, status, lines] of live) {
    const at = fmt(new Date(now.getTime() - minsAgo * 60000));
    const orderId = run(
      "INSERT INTO orders (type, table_id, guests, status, created_by, created_at) VALUES ('dine_in', ?, ?, 'open', ?, ?)",
      tbl(tableName), guests, waiter, at,
    ).id;
    run('UPDATE orders SET order_no=? WHERE id=?', `${settings.invoice_prefix}-${String(orderId).padStart(5, '0')}`, orderId);
    const kotNo = get("SELECT COALESCE(MAX(kot_no),0)+1 AS n FROM kots WHERE date(created_at)=date('now','localtime')")!.n;
    const kotId = run('INSERT INTO kots (order_id, kot_no, status, created_by, created_at) VALUES (?,?,?,?,?)', orderId, kotNo, status, waiter, at).id;
    const rows: CalcLine[] = [];
    for (const [name, variant, qty] of lines) {
      const it = items.find((i) => i.name === name)!;
      const price: number = variant ? it.variants.find((v: Row) => v.name === variant).price : it.price;
      rows.push({ price, qty, tax_rate: it.tax_rate });
      run(
        'INSERT INTO order_items (order_id, kot_id, item_id, name, variant, price, qty, tax_rate, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        orderId, kotId, it.id, it.name, variant, price, qty, it.tax_rate, at,
      );
    }
    const tot = computeTotals(rows, { type: 'dine_in', discount_type: 'flat', discount_value: 0 }, settings);
    run('UPDATE orders SET subtotal=?, tax=?, service_charge=?, round_off=?, total=? WHERE id=?', tot.subtotal, tot.tax, tot.service_charge, tot.round_off, tot.total, orderId);
  }
}
