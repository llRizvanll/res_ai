// Owner overview: data counts per area and the set-up checklist.
import { ADMIN, api } from '../../core/http.js';
import { count } from '../../core/util.js';
import { verifyPassword } from '../../core/passwords.js';
import { get, getSettings } from '../../db/index.js';

api.get('/api/admin/summary', ADMIN, () => ({
  demo: getSettings().demo_data === '1',
  orders: count('SELECT COUNT(*) AS n FROM orders'),
  open_orders: count("SELECT COUNT(*) AS n FROM orders WHERE status='open'"),
  activity: count('SELECT COUNT(*) AS n FROM activity_log'),
  customers: count('SELECT COUNT(*) AS n FROM customers'),
  reservations: count('SELECT COUNT(*) AS n FROM reservations'),
  expenses: count('SELECT COUNT(*) AS n FROM expenses'),
  stock_moves: count('SELECT COUNT(*) AS n FROM stock_moves'),
  inventory: count('SELECT COUNT(*) AS n FROM inventory'),
  items: count('SELECT COUNT(*) AS n FROM items'),
  categories: count('SELECT COUNT(*) AS n FROM categories'),
  areas: count('SELECT COUNT(*) AS n FROM areas'),
  tables: count('SELECT COUNT(*) AS n FROM dining_tables'),
  staff: count('SELECT COUNT(*) AS n FROM users'),
}));

api.get('/api/admin/setup', ADMIN, ({ user }) => {
  const s = getSettings();
  const pw = get('SELECT password FROM users WHERE id=?', user.id)!.password;
  return {
    demo: s.demo_data === '1',
    steps: {
      branding: !['My Restaurant', 'Spice Garden', ''].includes(s.name || '') || !!s.logo,
      business: !!(s.address && s.phone),
      billing: s.setup_billing === '1',
      floor: count('SELECT COUNT(*) AS n FROM dining_tables') > 0,
      menu: count('SELECT COUNT(*) AS n FROM items') > 0,
      inventory: count('SELECT COUNT(*) AS n FROM inventory') > 0,
      staff: count('SELECT COUNT(*) AS n FROM users WHERE active=1') > 1,
      password: !verifyPassword('admin123', pw),
    },
  };
});
