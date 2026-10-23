import { all, get, run, tx, hashPassword, getSettings, type Row } from './db.js';
import { computeTotals, type CalcLine } from '../shared/calc.js';

export const DEFAULT_SETTINGS = {
  name: 'Spice Garden',
  tagline: 'Family Restaurant',
  address: '12, MG Road, Bengaluru, Karnataka 560001',
  phone: '+91 98765 43210',
  email: 'hello@spicegarden.example',
  gstin: '29ABCDE1234F1Z5',
  fssai: '11223344556677',
  currency: '₹',
  service_charge: '0',
  packaging_charge: '20',
  round_off: '1',
  invoice_prefix: 'INV',
  invoice_footer: 'Thank you for dining with us! Please visit again.',
  loyalty_rate: '1',
  kot_auto_print: '0',
  bill_auto_print: '0',
};

// Adds any setting keys introduced by newer versions without touching existing values
export function ensureSettings() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', k, v);
  }
}

type MenuRow = [name: string, price: number, veg: number, code: string, variants?: [string, number][]];

const MENU: Record<string, MenuRow[]> = {
  Starters: [
    ['Paneer Tikka', 260, 1, 'PT', [['Half', 160], ['Full', 260]]],
    ['Veg Spring Roll', 180, 1, 'VSR'],
    ['Hara Bhara Kabab', 220, 1, 'HBK'],
    ['Chicken 65', 280, 0, 'C65'],
    ['Chicken Tikka', 300, 0, 'CT', [['Half', 180], ['Full', 300]]],
    ['Fish Amritsari', 340, 0, 'FA'],
  ],
  'Main Course': [
    ['Paneer Butter Masala', 280, 1, 'PBM'],
    ['Dal Makhani', 220, 1, 'DM'],
    ['Kadai Paneer', 270, 1, 'KP'],
    ['Veg Kolhapuri', 240, 1, 'VK'],
    ['Butter Chicken', 340, 0, 'BC', [['Half', 200], ['Full', 340]]],
    ['Chicken Curry', 300, 0, 'CC'],
    ['Mutton Rogan Josh', 420, 0, 'MRJ'],
  ],
  Breads: [
    ['Tandoori Roti', 30, 1, 'TR'],
    ['Butter Roti', 40, 1, 'BR'],
    ['Butter Naan', 60, 1, 'BN'],
    ['Garlic Naan', 80, 1, 'GN'],
    ['Lachha Paratha', 70, 1, 'LP'],
  ],
  'Rice & Biryani': [
    ['Steamed Rice', 140, 1, 'SR'],
    ['Jeera Rice', 170, 1, 'JR'],
    ['Veg Biryani', 240, 1, 'VB'],
    ['Chicken Biryani', 320, 0, 'CB', [['Regular', 320], ['Family Pack', 720]]],
    ['Mutton Biryani', 400, 0, 'MB'],
  ],
  Chinese: [
    ['Veg Hakka Noodles', 190, 1, 'VHN'],
    ['Veg Manchurian', 210, 1, 'VM', [['Dry', 210], ['Gravy', 220]]],
    ['Chicken Fried Rice', 230, 0, 'CFR'],
    ['Chilli Chicken', 290, 0, 'CHC', [['Dry', 290], ['Gravy', 300]]],
  ],
  Beverages: [
    ['Masala Chai', 40, 1, 'MC'],
    ['Cold Coffee', 120, 1, 'CF'],
    ['Fresh Lime Soda', 90, 1, 'FLS', [['Sweet', 90], ['Salted', 90], ['Mixed', 90]]],
    ['Mango Lassi', 110, 1, 'ML'],
    ['Soft Drink', 60, 1, 'SD'],
    ['Mineral Water', 30, 1, 'MW'],
  ],
  Desserts: [
    ['Gulab Jamun', 90, 1, 'GJ'],
    ['Rasmalai', 120, 1, 'RM'],
    ['Brownie with Ice Cream', 180, 1, 'BIC'],
    ['Kulfi', 100, 1, 'KF'],
  ],
};

const INVENTORY: [string, string, number, number, number][] = [
  ['Paneer', 'kg', 8, 2, 380], ['Chicken', 'kg', 15, 5, 240], ['Mutton', 'kg', 6, 2, 650],
  ['Basmati Rice', 'kg', 25, 10, 110], ['Wheat Flour (Atta)', 'kg', 20, 5, 45], ['Maida', 'kg', 15, 5, 50],
  ['Butter', 'kg', 5, 1, 520], ['Cooking Oil', 'ltr', 20, 5, 150], ['Onion', 'kg', 30, 10, 35],
  ['Tomato', 'kg', 6, 8, 40], ['Milk', 'ltr', 15, 5, 60], ['Fresh Cream', 'ltr', 4, 1, 220],
  ['Spice Mix', 'kg', 5, 1, 400], ['Coffee Powder', 'kg', 1, 0.25, 900], ['Tea Leaves', 'kg', 2, 0.5, 450],
  ['Sugar', 'kg', 10, 3, 45], ['Lemons', 'pcs', 100, 30, 3], ['Soft Drink Bottles', 'pcs', 20, 24, 25],
  ['Water Bottles', 'pcs', 60, 24, 10], ['Fish Fillet', 'kg', 4, 2, 520],
];

const RECIPES: Record<string, [string, number][]> = {
  'Paneer Tikka': [['Paneer', 0.2], ['Spice Mix', 0.01], ['Cooking Oil', 0.02]],
  'Paneer Butter Masala': [['Paneer', 0.18], ['Butter', 0.03], ['Fresh Cream', 0.03], ['Tomato', 0.15], ['Onion', 0.1]],
  'Kadai Paneer': [['Paneer', 0.18], ['Onion', 0.1], ['Tomato', 0.1], ['Cooking Oil', 0.03]],
  'Dal Makhani': [['Butter', 0.02], ['Fresh Cream', 0.02]],
  'Butter Chicken': [['Chicken', 0.25], ['Butter', 0.04], ['Fresh Cream', 0.04], ['Tomato', 0.15]],
  'Chicken Tikka': [['Chicken', 0.25], ['Spice Mix', 0.01]],
  'Chicken 65': [['Chicken', 0.25], ['Cooking Oil', 0.05]],
  'Chicken Curry': [['Chicken', 0.25], ['Onion', 0.15], ['Tomato', 0.1]],
  'Chilli Chicken': [['Chicken', 0.22], ['Cooking Oil', 0.04]],
  'Fish Amritsari': [['Fish Fillet', 0.2], ['Cooking Oil', 0.05]],
  'Mutton Rogan Josh': [['Mutton', 0.25], ['Onion', 0.1]],
  'Mutton Biryani': [['Mutton', 0.2], ['Basmati Rice', 0.2]],
  'Chicken Biryani': [['Chicken', 0.2], ['Basmati Rice', 0.2]],
  'Veg Biryani': [['Basmati Rice', 0.2]],
  'Steamed Rice': [['Basmati Rice', 0.15]],
  'Jeera Rice': [['Basmati Rice', 0.15]],
  'Chicken Fried Rice': [['Basmati Rice', 0.15], ['Chicken', 0.1]],
  'Tandoori Roti': [['Wheat Flour (Atta)', 0.08]],
  'Butter Roti': [['Wheat Flour (Atta)', 0.08], ['Butter', 0.005]],
  'Butter Naan': [['Maida', 0.1], ['Butter', 0.01]],
  'Garlic Naan': [['Maida', 0.1], ['Butter', 0.01]],
  'Lachha Paratha': [['Wheat Flour (Atta)', 0.1], ['Butter', 0.015]],
  'Masala Chai': [['Milk', 0.1], ['Tea Leaves', 0.005], ['Sugar', 0.01]],
  'Cold Coffee': [['Milk', 0.2], ['Coffee Powder', 0.01], ['Sugar', 0.02]],
  'Fresh Lime Soda': [['Lemons', 1], ['Sugar', 0.02]],
  'Mango Lassi': [['Milk', 0.2], ['Sugar', 0.02]],
  'Soft Drink': [['Soft Drink Bottles', 1]],
  'Mineral Water': [['Water Bottles', 1]],
};

const CUSTOMERS: [string, string, string | null][] = [
  ['Aarav Sharma', '9810011111', '1990-03-14'], ['Priya Nair', '9820022222', '1988-07-22'],
  ['Rohan Gupta', '9830033333', null], ['Ananya Iyer', '9840044444', '1995-11-02'],
  ['Vikram Singh', '9850055555', null], ['Sneha Reddy', '9860066666', '1992-01-30'],
  ['Karan Mehta', '9870077777', null], ['Divya Menon', '9880088888', '1998-05-18'],
  ['Arjun Patel', '9890099999', null], ['Meera Joshi', '9800012345', '1985-09-09'],
  ['Farhan Khan', '9811122334', null], ['Lakshmi Rao', '9822233445', '1979-12-25'],
];

const rand = (a: number, b: number): number => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const pad = (n: number): string => String(n).padStart(2, '0');
const fmt = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fmtDay = (d: Date): string => fmt(d).slice(0, 10);

export function seed({ demo = true } = {}) {
  tx(() => {
    ensureSettings();

    const users = [
      ['Restaurant Owner', 'admin', 'admin123', 'admin'],
      ['Floor Manager', 'manager', 'manager123', 'manager'],
      ['Cashier Desk', 'cashier', 'cashier123', 'cashier'],
      ['Ravi (Captain)', 'waiter', 'waiter123', 'waiter'],
      ['Kitchen Display', 'kitchen', 'kitchen123', 'kitchen'],
    ];
    for (const [name, username, pw, role] of users) {
      run('INSERT INTO users (name, username, password, role) VALUES (?,?,?,?)', name, username, hashPassword(pw), role);
    }

    const ground = run('INSERT INTO areas (name, sort) VALUES (?, ?)', 'Ground Floor', 1).id;
    const terrace = run('INSERT INTO areas (name, sort) VALUES (?, ?)', 'Terrace', 2).id;
    for (let i = 1; i <= 10; i++) run('INSERT INTO dining_tables (area_id, name, seats, sort) VALUES (?,?,?,?)', ground, `T${i}`, i <= 6 ? 4 : 6, i);
    for (let i = 1; i <= 5; i++) run('INSERT INTO dining_tables (area_id, name, seats, sort) VALUES (?,?,?,?)', terrace, `R${i}`, i <= 3 ? 2 : 8, i);

    let csort = 0;
    for (const [cat, items] of Object.entries(MENU)) {
      const catId = run('INSERT INTO categories (name, sort) VALUES (?, ?)', cat, ++csort).id;
      items.forEach(([name, price, veg, code, variants], idx) => {
        const v = (variants || []).map(([n, p]) => ({ name: n, price: p }));
        run(
          'INSERT INTO items (category_id, name, code, price, tax_rate, veg, variants, sort) VALUES (?,?,?,?,?,?,?,?)',
          catId, name, code, price, 5, veg, JSON.stringify(v), idx,
        );
      });
    }

    for (const [name, unit, stock, min, cost] of INVENTORY) {
      run('INSERT INTO inventory (name, unit, stock, min_stock, cost) VALUES (?,?,?,?,?)', name, unit, stock, min, cost);
    }
    for (const [itemName, parts] of Object.entries(RECIPES)) {
      const item = get('SELECT id FROM items WHERE name=?', itemName);
      for (const [invName, qty] of parts) {
        const inv = get('SELECT id FROM inventory WHERE name=?', invName);
        if (item && inv) run('INSERT INTO recipes (item_id, inventory_id, qty) VALUES (?,?,?)', item.id, inv.id, qty);
      }
    }

    for (const [name, phone, birthday] of CUSTOMERS) {
      run('INSERT INTO customers (name, phone, birthday) VALUES (?,?,?)', name, phone, birthday);
    }

    if (demo) seedDemoActivity();
  });
}

function seedDemoActivity() {
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
