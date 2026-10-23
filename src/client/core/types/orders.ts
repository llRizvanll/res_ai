// Orders, their lines, payments and kitchen tickets.
import type { OrderType } from '../../../shared/domain.js';

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
