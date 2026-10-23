// Stock, reservations and expenses.
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
