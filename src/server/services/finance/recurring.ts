// Recurring expenses: due dates, posting them as real expenses, and their monthly cost.
import { all, current, run, tx } from '../../db/index.js';
import { log } from '../../core/log.js';
import { todayStr } from '../../core/util.js';
import { r2 } from '../../../shared/calc.js';
import { FREQUENCY_PER_YEAR, type Frequency } from '../../../shared/domain.js';
import { addDays, addMonths } from './calendar.js';

/** How many times a year each frequency happens, for monthly-equivalent maths */
const PER_YEAR = FREQUENCY_PER_YEAR;

export function nextOccurrence(freq: Frequency, current: string, anchorDay: number): string {
  switch (freq) {
    case 'daily':
      return addDays(current, 1);
    case 'weekly':
      return addDays(current, 7);
    case 'monthly':
      return addMonths(current, 1, anchorDay);
    case 'quarterly':
      return addMonths(current, 3, anchorDay);
    case 'yearly':
      return addMonths(current, 12, anchorDay);
  }
}

/** Dates a template falls on within [from, to], without writing anything (used for projections) */
export function occurrences(r: { frequency: Frequency; start_date: string; next_date: string; end_date: string | null }, from: string, to: string): string[] {
  const out: string[] = [];
  const anchor = Number(r.start_date.slice(8));
  let d = r.next_date;
  for (let guard = 0; d <= to && guard < 2000; guard++) {
    if (r.end_date && d > r.end_date) break;
    if (d >= from) out.push(d);
    d = nextOccurrence(r.frequency, d, anchor);
  }
  return out;
}

/** Writes every due occurrence (up to `today`) as a real expense. Safe to call often; returns how many were added. */
export function materializeRecurring(today: string): number {
  let added = 0;
  for (const r of all('SELECT * FROM recurring_expenses WHERE active=1 AND next_date <= ?', today)) {
    const anchor = Number(r.start_date.slice(8));
    let d: string = r.next_date;
    for (let guard = 0; d <= today && guard < 2000; guard++) {
      if (r.end_date && d > r.end_date) break;
      run(
        'INSERT INTO expenses (date, category, amount, paid_to, note, user_id, recurring_id) VALUES (?,?,?,?,?,?,?)',
        d, r.category, r.amount, r.paid_to, r.note || `Recurring (${r.frequency})`, r.created_by, r.id,
      );
      added++;
      d = nextOccurrence(r.frequency, d, anchor);
    }
    const finished = r.end_date && d > r.end_date;
    run('UPDATE recurring_expenses SET next_date=?, active=? WHERE id=?', d, finished ? 0 : 1, r.id);
  }
  return added;
}

/** Posts any recurring expenses that have fallen due (rent on the 1st, weekly gas, …); errors are logged */
export function syncRecurring() {
  try {
    const n = tx(() => materializeRecurring(todayStr()));
    if (n) log.info(`[${current().slug}] Added ${n} recurring expense(s)`);
  } catch (e) {
    log.error('Recurring expenses failed', e);
  }
}

/** Fixed costs per month from active recurring templates */
export function recurringMonthly(): number {
  return r2(all('SELECT frequency, amount FROM recurring_expenses WHERE active=1').reduce((a, r) => a + (r.amount * PER_YEAR[r.frequency as Frequency]) / 12, 0));
}

/** Total of all active recurring expenses falling due within [from, to] (for projections) */
export function scheduledBetween(from: string, to: string): number {
  return sum(all('SELECT * FROM recurring_expenses WHERE active=1').map((t) => occurrences(t as never, from, to).length * t.amount));
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
