// The app's pages: who may open each one and where it sits in the sidebar.
import type { ViewModule } from '../core/types/app.js';
import type { Role } from '../../shared/domain.js';
import { ROLE_GROUPS } from '../../shared/domain.js';

const { ALL, SERVICE, FRONT, MGR, ADMIN } = ROLE_GROUPS;

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  roles: Role[];
  load: () => Promise<ViewModule>;
  group?: string;
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◧', roles: FRONT, load: () => import('../views/dashboard.js') },
  { id: 'pos', label: 'Billing / POS', icon: '⊞', roles: SERVICE, load: () => import('../views/pos/index.js') },
  { id: 'tables', label: 'Tables', icon: '▦', roles: SERVICE, load: () => import('../views/tables.js') },
  { id: 'kds', label: 'Kitchen Display', icon: '♨', roles: ALL, load: () => import('../views/kds.js') },
  { id: 'orders', label: 'Orders', icon: '≡', roles: SERVICE, load: () => import('../views/orders.js') },
  { id: 'reservations', label: 'Reservations', icon: '◷', roles: SERVICE, load: () => import('../views/reservations.js') },
  { id: 'customers', label: 'Customers', icon: '☺', roles: FRONT, load: () => import('../views/customers.js'), group: 'Manage' },
  { id: 'menu', label: 'Menu', icon: '☰', roles: MGR, load: () => import('../views/menu/index.js'), group: 'Manage' },
  { id: 'inventory', label: 'Inventory', icon: '▤', roles: MGR, load: () => import('../views/inventory.js'), group: 'Manage' },
  { id: 'pnl', label: 'Profit & Loss', icon: '₹', roles: MGR, load: () => import('../views/pnl/index.js'), group: 'Manage' },
  { id: 'insights', label: 'Growth & insights', icon: '↗', roles: MGR, load: () => import('../views/insights.js'), group: 'Manage' },
  { id: 'expenses', label: 'Expenses', icon: '⊖', roles: MGR, load: () => import('../views/expenses/index.js'), group: 'Manage' },
  { id: 'reports', label: 'Reports', icon: '◔', roles: MGR, load: () => import('../views/reports.js'), group: 'Manage' },
  { id: 'demo', label: 'Demo restaurant', icon: '◎', roles: ADMIN, load: () => import('../views/demo.js'), group: 'Admin' },
  { id: 'activity', label: 'Activity log', icon: '☷', roles: ADMIN, load: () => import('../views/activity.js'), group: 'Admin' },
  { id: 'setup', label: 'Getting started', icon: '✓', roles: ADMIN, load: () => import('../views/setup.js'), group: 'Admin' },
  { id: 'staff', label: 'Staff & Roles', icon: '⚇', roles: ADMIN, load: () => import('../views/staff.js'), group: 'Admin' },
  { id: 'settings', label: 'Settings', icon: '⚙', roles: ADMIN, load: () => import('../views/settings/index.js'), group: 'Admin' },
];

export const navFor = (role: Role) => NAV.filter((n) => n.roles.includes(role));

/** Where each role lands after signing in */
export const homeFor = (role: Role): string => (role === 'kitchen' ? 'kds' : role === 'waiter' ? 'tables' : 'dashboard');
