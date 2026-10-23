// Floor: dining areas, tables and running takeaway/delivery orders.
import type { OrderType } from '../../../shared/domain.js';

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
