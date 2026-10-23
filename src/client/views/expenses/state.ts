// Expenses page state shared by its tabs.
import type { Expense } from '../../core/types/operations.js';
import { addDays, periodRange, today } from '../../core/dates.js';
import type { Frequency } from '../../../shared/domain.js';

export type Unit = 'day' | 'week' | 'month' | 'year' | 'custom';

export interface Recurring {
  id: number;
  category: string;
  amount: number;
  paid_to: string | null;
  note: string | null;
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  next_date: string;
  active: number;
  posted: number;
  posted_total: number;
}
export interface ExpenseRow extends Expense {
  recurring_id: number | null;
}

/** The page's state: which tab and period are shown, filters, and the loaded expenses */
export const E = {
  root: document.createElement('div') as HTMLElement, // replaced on render; detached until then
  tab: 'list' as 'list' | 'recurring',
  unit: 'month' as Unit,
  anchor: today(),
  custom: [addDays(today(), -29), today()] as [string, string],
  catFilter: '',
  q: '',
  list: [] as ExpenseRow[],
  /** Recurring templates currently shown */
  recurring: [] as Recurring[],
};

export const range = (): [string, string] => (E.unit === 'custom' ? E.custom : periodRange(E.unit, E.anchor));
