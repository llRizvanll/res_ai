// Profit & loss statements and growth insights.
import { fail, MGR, api } from '../core/http.js';
import { todayStr } from '../core/util.js';
import { numIn, dateOpt } from '../core/validate.js';
import { pnl, pnlByMonth, insights, addDays, syncRecurring } from '../services/finance/index.js';

// ---- profit & loss and growth insights
function rangeOf(query: Record<string, string>): [string, string] {
  const from = dateOpt(query.from, 'From date') || todayStr().slice(0, 8) + '01';
  const to = dateOpt(query.to, 'To date') || todayStr();
  if (to < from) fail(400, '“To” date must be on or after the “From” date');
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 366 * 3) fail(400, 'Choose a range of three years or less');
  return [from, to];
}

api.get('/api/pnl', MGR, ({ query }) => {
  syncRecurring();
  const [from, to] = rangeOf(query);
  const len = Math.round((Date.parse(to) - Date.parse(from)) / 86400_000);
  const prevTo = addDays(from, -1);
  const lastYear = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, '-02-28');
  return {
    current: pnl(from, to),
    previous: pnl(addDays(prevTo, -len), prevTo),
    last_year: pnl(lastYear(from), lastYear(to)),
  };
});

api.get('/api/pnl/monthly', MGR, ({ query }) => {
  syncRecurring();
  const year = Math.round(numIn(query.year, 'Year', 2000, 2100, Number(todayStr().slice(0, 4))));
  return { year, months: pnlByMonth(year, todayStr()) };
});

api.get('/api/insights', MGR, () => {
  syncRecurring();
  return insights(todayStr());
});
