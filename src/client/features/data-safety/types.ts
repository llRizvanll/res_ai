// Shapes returned by the owner-tools API and shared by the data-safety cards.
export interface DataSummary {
  demo: boolean;
  orders: number;
  open_orders: number;
  activity: number;
  customers: number;
  reservations: number;
  expenses: number;
  stock_moves: number;
  inventory: number;
  items: number;
  categories: number;
  areas: number;
  tables: number;
  staff: number;
}

export interface Health {
  healthy: boolean;
  db_size: number;
  data_dir: string;
  backup_dir: string;
  backups: number;
  newest_backup: { name: string; created: string } | null;
  interval_min: number;
  mirror: { dir: string | null; ok: boolean | null; at: string | null; error: string | null };
  started_at: string;
  recovery_note: string | null;
  warnings: string[];
}

export interface DailyRow {
  day: string;
  orders: number;
  sales: number;
  backup: Backup | null;
  downloaded: { at: string; user_name: string } | null;
  accounts: string[];
}

export interface Backup {
  name: string;
  size: number;
  created: string;
}

/** Everything the Data tab loads before drawing its cards */
export interface TabData {
  summary: DataSummary;
  backups: Backup[];
  health: Health;
  daily: { closing_time: string; days: DailyRow[] };
}
