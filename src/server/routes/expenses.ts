// Expenses and recurring expense templates.
import { fail, type Body, MGR, api } from '../core/http.js';
import { todayStr } from '../core/util.js';
import { num, text, numIn, dateOpt, requireRow } from '../core/validate.js';
import { onAudit, cur$, row } from '../core/audit.js';
import { all, get, run, tx } from '../db/index.js';
import { safeguard } from '../services/backup.js';
import { addDays, nextOccurrence, syncRecurring } from '../services/finance/index.js';
import { FREQUENCIES, type Frequency } from '../../shared/domain.js';

function expValues(b: Body): unknown[] {
  const amount = numIn(b.amount, 'Amount', 0.01, 100_000_000);
  const date = dateOpt(b.date, 'Date') || fail(400, 'Date is required');
  const maxDay = get<{ d: string }>("SELECT date('now','localtime','+31 day') AS d")!.d;
  if (date > maxDay) fail(400, 'Expense date is too far in the future');
  return [date, text(b.category, 'Category', 40) || 'Other', amount, text(b.paid_to, 'Paid to', 80), text(b.note, 'Note', 300)];
}

// ---- recurring expense templates
function recurringValues(b: Body): { category: string; amount: number; paid_to: string | null; note: string | null; frequency: Frequency; start_date: string; end_date: string | null } {
  const frequency = String(b.frequency) as Frequency;
  if (!FREQUENCIES.includes(frequency)) fail(400, `Repeat must be one of: ${FREQUENCIES.join(', ')}`);
  const start = dateOpt(b.start_date, 'Start date') || fail(400, 'Start date is required');
  if (start < addDays(todayStr(), -366)) fail(400, 'Start date can be at most one year in the past');
  const end = dateOpt(b.end_date, 'End date');
  if (end && end < start) fail(400, 'End date must be after the start date');
  return {
    category: text(b.category, 'Category', 40, true)!, amount: numIn(b.amount, 'Amount', 0.01, 100_000_000), paid_to: text(b.paid_to, 'Paid to', 80),
    note: text(b.note, 'Note', 300), frequency, start_date: start, end_date: end,
  };
}

api.get('/api/expenses', MGR, ({ query }) => (
  syncRecurring(),
  all(
    `SELECT e.*, u.name AS user_name FROM expenses e LEFT JOIN users u ON u.id=e.user_id
     WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`,
    dateOpt(query.from, 'From date') || '0000-01-01', dateOpt(query.to, 'To date') || '9999-12-31',
  )
));


api.get('/api/expenses/recurring', MGR, () => {
  syncRecurring();
  return all(
    `SELECT r.*, (SELECT COUNT(*) FROM expenses e WHERE e.recurring_id=r.id) AS posted,
      (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.recurring_id=r.id) AS posted_total
     FROM recurring_expenses r ORDER BY r.active DESC, r.next_date`,
  );
});

api.post('/api/expenses/recurring', MGR, ({ body, user }) => {
  const v = recurringValues(body);
  const id = run(
    'INSERT INTO recurring_expenses (category, amount, paid_to, note, frequency, start_date, end_date, next_date, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    v.category, v.amount, v.paid_to, v.note, v.frequency, v.start_date, v.end_date, v.start_date, user.id,
  ).id;
  syncRecurring();
  return get('SELECT * FROM recurring_expenses WHERE id=?', id);
});

api.put('/api/expenses/recurring/:id', MGR, ({ params, body }) => {
  const r = requireRow(get('SELECT * FROM recurring_expenses WHERE id=?', params.id), 'Recurring expense');
  if (Object.keys(body).length === 1 && 'active' in body) {
    run('UPDATE recurring_expenses SET active=? WHERE id=?', body.active ? 1 : 0, r.id);
  } else {
    const v = recurringValues(body);
    // Keep going from where it left off: never re-post a date that was already posted
    let next = v.start_date;
    const last = get<{ d: string | null }>('SELECT MAX(date) AS d FROM expenses WHERE recurring_id=?', r.id)!.d;
    if (last) {
      const anchor = Number(v.start_date.slice(8));
      for (let g = 0; next <= last && g < 5000; g++) next = nextOccurrence(v.frequency, next, anchor);
    }
    run(
      'UPDATE recurring_expenses SET category=?, amount=?, paid_to=?, note=?, frequency=?, start_date=?, end_date=?, next_date=?, active=1 WHERE id=?',
      v.category, v.amount, v.paid_to, v.note, v.frequency, v.start_date, v.end_date, next, r.id,
    );
  }
  syncRecurring();
  return get('SELECT * FROM recurring_expenses WHERE id=?', r.id);
});

api.del('/api/expenses/recurring/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM recurring_expenses WHERE id=?', params.id), 'Recurring expense');
  safeguard();
  // Expenses already posted are real history and stay; they just lose the link
  tx(() => {
    run('UPDATE expenses SET recurring_id=NULL WHERE recurring_id=?', params.id);
    run('DELETE FROM recurring_expenses WHERE id=?', params.id);
  });
});


api.post('/api/expenses', MGR, ({ body, user }) => {
  run('INSERT INTO expenses (date, category, amount, paid_to, note, user_id) VALUES (?,?,?,?,?,?)', ...expValues(body), user.id);
});

api.put('/api/expenses/:id', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM expenses WHERE id=?', params.id), 'Expense');
  run('UPDATE expenses SET date=?, category=?, amount=?, paid_to=?, note=? WHERE id=?', ...expValues(body), params.id);
});

api.del('/api/expenses/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM expenses WHERE id=?', params.id), 'Expense');
  safeguard();
  run('DELETE FROM expenses WHERE id=?', params.id);
});


onAudit('POST /api/expenses', { after: (c) => ['expense.create', `Added expense ${c.body.category} ${cur$(c.body.amount)}${c.body.paid_to ? ` to ${c.body.paid_to}` : ''}`, { amount: num(c.body.amount) }] });

onAudit('PUT /api/expenses/:id', { before: row('expenses'), after: (c, _r, b) => ['expense.update', `Edited expense ${b?.category}: ${cur$(b?.amount)} → ${cur$(c.body.amount)}`, { id: c.params.id, amount: num(c.body.amount) }] });

onAudit('DELETE /api/expenses/:id', { before: row('expenses'), after: (c, _r, b) => ['expense.delete', `Deleted expense ${b?.category} ${cur$(b?.amount)} (${b?.date})`, { id: c.params.id, amount: b?.amount, details: b }] });


onAudit('POST /api/expenses/recurring', { after: (_c, r) => ['expense.recurring_create', `Set up ${r.frequency} expense ${r.category} ${cur$(r.amount)} from ${r.start_date}`, { id: r.id, amount: r.amount }] });

onAudit('PUT /api/expenses/recurring/:id', {
  after: (c, r) => ['expense.recurring_update', 'active' in c.body && Object.keys(c.body).length === 1 ? `${c.body.active ? 'Resumed' : 'Paused'} ${r.frequency} expense ${r.category}` : `Edited ${r.frequency} expense ${r.category} → ${cur$(r.amount)}`, { id: r.id }],
});

onAudit('DELETE /api/expenses/recurring/:id', { before: row('recurring_expenses'), after: (c, _r, b) => ['expense.recurring_delete', `Stopped ${b?.frequency} expense ${b?.category} ${cur$(b?.amount)}`, { id: c.params.id }] });
