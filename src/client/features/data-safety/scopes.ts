// What "Clear selected data" can clear, with a description and a live count for each.
import type { DataSummary } from './types.js';

export interface Scope {
  id: string;
  label: string;
  desc: string;
  n: (s: DataSummary) => string;
}

export const SCOPES: Scope[] = [
  { id: 'orders', label: 'Orders & sales history', desc: 'All bills, KOTs and running orders. Invoice numbers restart from 1 and customer totals go back to zero.', n: (s) => `${s.orders} orders` },
  { id: 'customers', label: 'Customers', desc: 'All customer profiles and loyalty points.', n: (s) => `${s.customers} customers` },
  { id: 'reservations', label: 'Reservations', desc: 'All table bookings.', n: (s) => `${s.reservations} bookings` },
  { id: 'expenses', label: 'Expenses', desc: 'All recorded expenses.', n: (s) => `${s.expenses} entries` },
  { id: 'stock_history', label: 'Stock movement log', desc: 'Purchase, wastage and usage history. Current stock levels stay as they are.', n: (s) => `${s.stock_moves} movements` },
  { id: 'stock_levels', label: 'Stock levels to zero', desc: 'Keeps your raw materials but sets every quantity to 0, ready for a fresh count.', n: (s) => `${s.inventory} materials` },
  { id: 'inventory', label: 'Raw materials & recipes', desc: 'Deletes all raw materials, their recipes and history.', n: (s) => `${s.inventory} materials` },
  { id: 'menu', label: 'Menu', desc: 'All categories and dishes (with their variants and recipes).', n: (s) => `${s.categories} categories · ${s.items} items` },
  { id: 'floor', label: 'Floor areas & tables', desc: 'All dining areas and tables.', n: (s) => `${s.areas} areas · ${s.tables} tables` },
  { id: 'staff', label: 'Other staff logins', desc: 'Deletes every account except yours.', n: (s) => `${Math.max(0, s.staff - 1)} accounts` },
  { id: 'settings', label: 'Business & billing settings', desc: 'Address, phone, GSTIN, charges, invoice prefix and footer go back to blank defaults.', n: () => '' },
  { id: 'activity', label: 'Activity log & download history', desc: 'Who-did-what history for every account. Usually kept; clear it only to remove demo activity.', n: (s) => `${s.activity} entries` },
  { id: 'branding', label: 'Name, logo & theme', desc: 'Back to “My Restaurant”, no logo, default colour.', n: () => '' },
];
