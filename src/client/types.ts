export type Role = 'admin' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type Settings = Record<string, string>;

export interface User {
  id: number;
  name: string;
  username: string;
  role: Role;
}

export interface Variant {
  name: string;
  price: number;
}

export interface Category {
  id: number;
  name: string;
  sort: number;
  active: number;
}

export interface MenuItem {
  id: number;
  category_id: number | null;
  name: string;
  code: string | null;
  description: string | null;
  price: number;
  tax_rate: number;
  veg: number;
  available: number;
  variants: Variant[];
  sort: number;
}

export interface Menu {
  categories: Category[];
  items: MenuItem[];
}

export interface Area {
  id: number;
  name: string;
  sort: number;
}

export interface DiningTable {
  id: number;
  area_id: number;
  name: string;
  seats: number;
  sort: number;
  order_id: number | null;
  order_no: string | null;
  total: number | null;
  guests: number | null;
  bill_printed: number | null;
  order_time: string | null;
  item_count: number | null;
}

export interface OpenOrderCard {
  id: number;
  order_no: string;
  type: OrderType;
  total: number;
  created_at: string;
  bill_printed: number;
  customer_name: string | null;
  customer_phone: string | null;
  item_count: number;
}

export interface FloorData {
  areas: Area[];
  tables: DiningTable[];
  open: OpenOrderCard[];
}

export interface OrderItem {
  id: number;
  order_id: number;
  kot_id: number | null;
  item_id: number | null;
  name: string;
  variant: string | null;
  price: number;
  qty: number;
  tax_rate: number;
  notes: string | null;
  cancelled: number;
  cancel_reason: string | null;
  kot_no?: number | null;
  kot_status?: string | null;
}

export interface Payment {
  mode: string;
  amount: number;
}

export interface Order {
  id: number;
  order_no: string;
  type: OrderType;
  table_id: number | null;
  table_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_points: number | null;
  guests: number;
  status: 'open' | 'completed' | 'cancelled';
  bill_printed: number;
  subtotal: number;
  discount_type: 'flat' | 'percent';
  discount_value: number;
  discount: number;
  tax: number;
  service_charge: number;
  packaging: number;
  round_off: number;
  total: number;
  payment_mode: string | null;
  payments: Payment[];
  notes: string | null;
  delivery_address: string | null;
  cancel_reason: string | null;
  created_by_name: string | null;
  settled_by_name: string | null;
  created_at: string;
  closed_at: string | null;
  items: OrderItem[];
}

export interface OrderRow {
  id: number;
  order_no: string;
  type: OrderType;
  status: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_mode: string | null;
  created_at: string;
  closed_at: string | null;
  guests: number;
  table_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_by_name: string | null;
  item_count: number;
}

export interface Kot {
  id: number;
  order_id: number;
  kot_no: number;
  status: 'new' | 'preparing' | 'ready' | 'served';
  created_at: string;
  updated_at: string | null;
  order_no: string;
  type: OrderType;
  order_notes: string | null;
  table_name: string | null;
  created_by_name: string | null;
  items: OrderItem[];
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  birthday: string | null;
  notes: string | null;
  points: number;
  total_spent: number;
  visits: number;
  last_visit: string | null;
  created_at: string;
}

export interface InventoryItem {
  id: number;
  name: string;
  unit: string;
  stock: number;
  min_stock: number;
  cost: number;
  used_in?: number;
  used_7d?: number;
}

export interface StockMove {
  id: number;
  inventory_id: number;
  type: string;
  qty: number;
  cost: number;
  supplier: string | null;
  note: string | null;
  created_at: string;
  name: string;
  unit: string;
  user_name: string | null;
  order_no: string | null;
}

export interface Reservation {
  id: number;
  name: string;
  phone: string | null;
  guests: number;
  date: string;
  time: string | null;
  table_id: number | null;
  table_name: string | null;
  status: 'booked' | 'seated' | 'cancelled' | 'no_show';
  notes: string | null;
}

export interface Expense {
  id: number;
  date: string;
  category: string;
  amount: number;
  paid_to: string | null;
  note: string | null;
  user_name: string | null;
}

export interface StaffUser extends User {
  phone: string | null;
  active: number;
  created_at: string;
}

/** Shared context handed to every view */
export interface AppCtx {
  user: User;
  settings: Settings;
  can(roles: Role[]): boolean;
  refreshSettings(s: Settings): void;
}

/** A view renders into the main area and may return a cleanup function */
export interface ViewModule {
  render(el: HTMLElement, params: Record<string, string>, ctx: AppCtx): Promise<void | (() => void)>;
  onEvent?(type: string): void;
}
