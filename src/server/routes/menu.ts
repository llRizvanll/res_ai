// Menu categories, items (with variants), availability and recipes.
import { fail, type Body, MGR, ALL, api } from '../core/http.js';
import { broadcast } from '../core/events.js';
import { str, text, numIn, refOpt, unique, requireRow, bulkIds } from '../core/validate.js';
import { onAudit, cur$, row } from '../core/audit.js';
import { all, get, run, tx, type Row } from '../db/index.js';
import { safeguard } from '../services/backup.js';
import { GST_RATES } from '../../shared/domain.js';
import { config } from '../config.js';

/** Items are stored with their variants as JSON text */
const parseItem = (i: Row): Row => ({ ...i, variants: JSON.parse(i.variants || '[]') });

function itemValues(b: Body, exceptId?: unknown): unknown[] {
  const name = text(b.name, 'Item name', 100, true);
  unique('items', 'name', name, 'Menu item', exceptId);
  const code = text(b.code, 'Short code', 10);
  if (code && !/^[A-Za-z0-9-]+$/.test(code)) fail(400, 'Short code can only use letters, numbers and dashes');
  unique('items', 'code', code, 'Short code', exceptId);
  const tax = numIn(b.tax_rate, 'GST rate', 0, 28, 0);
  if (!GST_RATES.includes(tax)) fail(400, `GST rate must be one of ${GST_RATES.join(', ')}%`);
  const raw = Array.isArray(b.variants) ? b.variants : [];
  if (raw.length > config.limits.variants) fail(400, `An item can have at most ${config.limits.variants} variants`);
  const variants = raw
    .filter((v: Row) => str(v?.name))
    .map((v: Row) => ({ name: text(v.name, 'Variant name', 40, true)!, price: numIn(v.price, `Price of ${v.name}`, 0, 1_000_000) }));
  const names = variants.map((v: Row) => v.name.toLowerCase());
  if (new Set(names).size !== names.length) fail(400, 'Variant names must be different from each other');
  return [refOpt(b.category_id, 'categories', 'Category'), name, code ? code.toUpperCase() : null, text(b.description, 'Description', 300),
    numIn(b.price, 'Price', 0, 1_000_000), tax, b.veg ? 1 : 0, b.available === false ? 0 : 1, JSON.stringify(variants), numIn(b.sort, 'Order', 0, 9999, 0)];
}

api.get('/api/menu', ALL, () => ({
  categories: all('SELECT * FROM categories ORDER BY sort, name'),
  items: all('SELECT * FROM items ORDER BY sort, name').map(parseItem),
}));


api.post('/api/categories', MGR, ({ body }) => {
  const name = text(body.name, 'Category name', 60, true);
  unique('categories', 'name', name, 'Category');
  const id = run('INSERT INTO categories (name, sort, active) VALUES (?,?,?)', name, numIn(body.sort, 'Order', 0, 9999, 0), body.active === false ? 0 : 1).id;
  broadcast('menu');
  return get('SELECT * FROM categories WHERE id=?', id);
});

api.put('/api/categories/:id', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM categories WHERE id=?', params.id), 'Category');
  const name = text(body.name, 'Category name', 60, true);
  unique('categories', 'name', name, 'Category', params.id);
  run('UPDATE categories SET name=?, sort=?, active=? WHERE id=?', name, numIn(body.sort, 'Order', 0, 9999, 0), body.active === false ? 0 : 1, params.id);
  broadcast('menu');
});

api.del('/api/categories/:id', MGR, ({ params }) => {
  safeguard();
  run('DELETE FROM categories WHERE id=?', params.id);
  broadcast('menu');
});


api.post('/api/items', MGR, ({ body }) => {
  const id = run(
    'INSERT INTO items (category_id, name, code, description, price, tax_rate, veg, available, variants, sort) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ...itemValues(body),
  ).id;
  broadcast('menu');
  return parseItem(get('SELECT * FROM items WHERE id=?', id)!);
});

api.put('/api/items/:id', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM items WHERE id=?', params.id), 'Item');
  run(
    'UPDATE items SET category_id=?, name=?, code=?, description=?, price=?, tax_rate=?, veg=?, available=?, variants=?, sort=? WHERE id=?',
    ...itemValues(body, params.id), params.id,
  );
  broadcast('menu');
  return parseItem(requireRow(get('SELECT * FROM items WHERE id=?', params.id), 'Item'));
});

api.patch('/api/items/:id/availability', ['admin', 'manager', 'kitchen'], ({ params, body }) => {
  requireRow(get('SELECT id FROM items WHERE id=?', params.id), 'Item');
  run('UPDATE items SET available=? WHERE id=?', body.available ? 1 : 0, params.id);
  broadcast('menu');
});

api.del('/api/items/:id', MGR, ({ params }) => {
  requireRow(get('SELECT id FROM items WHERE id=?', params.id), 'Item');
  safeguard();
  run('DELETE FROM items WHERE id=?', params.id);
  broadcast('menu');
});


api.get('/api/items/:id/recipe', MGR, ({ params }) =>
  all('SELECT r.inventory_id, r.qty, i.name, i.unit FROM recipes r JOIN inventory i ON i.id=r.inventory_id WHERE r.item_id=? ORDER BY i.name', params.id),
);

api.put('/api/items/:id/recipe', MGR, ({ params, body }) => {
  requireRow(get('SELECT id FROM items WHERE id=?', params.id), 'Item');
  const lines = (Array.isArray(body.lines) ? body.lines : []).filter((r: Row) => r?.inventory_id);
  if (lines.length > config.limits.recipeLines) fail(400, `A recipe can have at most ${config.limits.recipeLines} ingredients`);
  const seen = new Set<number>();
  const clean = lines.map((r: Row) => {
    const inv = refOpt(r.inventory_id, 'inventory', 'Ingredient')!;
    if (seen.has(inv)) fail(400, 'Each ingredient can be listed only once');
    seen.add(inv);
    return [inv, numIn(r.qty, 'Ingredient quantity', 0.0001, 10_000)];
  });
  tx(() => {
    run('DELETE FROM recipes WHERE item_id=?', params.id);
    for (const [inv, qty] of clean) run('INSERT INTO recipes (item_id, inventory_id, qty) VALUES (?,?,?)', params.id, inv, qty);
  });
});


api.post('/api/items/bulk-delete', MGR, ({ body }) => {
  const ids = bulkIds(body);
  safeguard();
  run(`DELETE FROM items WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  broadcast('menu');
  return { deleted: ids.length };
});

onAudit('POST /api/categories', { after: (_c, r) => ['menu.category_create', `Added category “${r.name}”`, { id: r.id }] });

onAudit('PUT /api/categories/:id', { before: row('categories'), after: (c, _r, b) => ['menu.category_update', `Edited category “${b?.name}”${b?.name !== c.body.name ? ` → “${c.body.name}”` : ''}`, { id: c.params.id }] });

onAudit('DELETE /api/categories/:id', { before: row('categories'), after: (c, _r, b) => ['menu.category_delete', `Deleted category “${b?.name}”`, { id: c.params.id }] });

onAudit('POST /api/items', { after: (_c, r) => ['menu.item_create', `Added “${r.name}” at ${cur$(r.price)}`, { id: r.id }] });

onAudit('PUT /api/items/:id', {
  before: row('items'),
  after: (_c, r, b) => ['menu.item_update', `Edited “${r.name}”${b && b.price !== r.price ? ` — price ${cur$(b.price)} → ${cur$(r.price)}` : ''}`, { id: r.id }],
});

onAudit('PATCH /api/items/:id/availability', { before: row('items'), after: (c, _r, b) => ['menu.availability', `“${b?.name}” marked ${c.body.available ? 'available' : 'out of stock'}`, { id: c.params.id }] });

onAudit('DELETE /api/items/:id', { before: row('items'), after: (c, _r, b) => ['menu.item_delete', `Deleted “${b?.name}”`, { id: c.params.id }] });

onAudit('PUT /api/items/:id/recipe', { before: row('items'), after: (c, _r, b) => ['menu.recipe', `Updated recipe of “${b?.name}”`, { id: c.params.id }] });

onAudit('POST /api/items/bulk-delete', {
  before: (c) => all(`SELECT name FROM items WHERE id IN (${bulkIds(c.body).map(() => '?').join(',')})`, ...bulkIds(c.body)).map((x) => x.name),
  after: (_c, r, b) => ['menu.item_delete', `Deleted ${r.deleted} items: ${(b as unknown as string[]).join(', ').slice(0, 200)}`],
});
