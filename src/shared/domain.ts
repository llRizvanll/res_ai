// Domain vocabulary shared by the server (validation) and the browser (labels, dropdowns).
// Change a list here and both sides stay in agreement.

export const ROLES = ['admin', 'manager', 'cashier', 'waiter', 'kitchen'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Owner / Admin',
  manager: 'Manager',
  cashier: 'Cashier',
  waiter: 'Captain / Waiter',
  kitchen: 'Kitchen',
};
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Everything, including staff, settings and backups',
  manager: 'Billing, menu, inventory, expenses and reports',
  cashier: 'Billing, settlements, discounts, customers, dashboard',
  waiter: 'Take orders, send KOTs, print bills, reservations',
  kitchen: 'Kitchen display and dish availability only',
};

/** Role groups used for permissions on both sides */
export const ROLE_GROUPS = {
  ADMIN: ['admin'] as Role[],
  MGR: ['admin', 'manager'] as Role[],
  FRONT: ['admin', 'manager', 'cashier'] as Role[],
  SERVICE: ['admin', 'manager', 'cashier', 'waiter'] as Role[],
  ALL: [...ROLES] as Role[],
};

export const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const ORDER_TYPE_LABELS: Record<string, string> = { dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' };

export const PAYMENT_MODES = ['cash', 'card', 'upi', 'other'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const PAYMENT_MODE_LABELS: Record<string, string> = { cash: 'Cash', card: 'Card', upi: 'UPI', other: 'Other', split: 'Split' };

/** GST slabs that apply to restaurant items and bought-in goods */
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];

export const STOCK_UNITS = ['kg', 'g', 'ltr', 'ml', 'pcs', 'pack', 'dozen', 'box', 'bottle', 'can', 'tray'];

export const KOT_STATUSES = ['new', 'preparing', 'ready', 'served'] as const;
export const RESERVATION_STATUSES = ['booked', 'seated', 'cancelled', 'no_show'] as const;
export const STOCK_MOVE_TYPES = ['purchase', 'wastage', 'adjust'] as const;

export const EXPENSE_CATEGORIES = [
  'Groceries & Vegetables', 'Rent', 'Salaries', 'Utilities', 'Maintenance', 'Marketing', 'Packaging', 'Licences & Taxes', 'Equipment', 'Other',
];

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
};
/** Occurrences per year, for monthly/yearly equivalents of recurring costs */
export const FREQUENCY_PER_YEAR: Record<Frequency, number> = { daily: 365, weekly: 52.143, monthly: 12, quarterly: 4, yearly: 1 };

export const STAFF_USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 100;
