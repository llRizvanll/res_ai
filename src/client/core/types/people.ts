// Staff accounts and customers.
import type { Role } from '../../../shared/domain.js';

export interface User {
  id: number;
  name: string;
  username: string;
  role: Role;
}

export interface StaffUser extends User {
  phone: string | null;
  active: number;
  created_at: string;
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
