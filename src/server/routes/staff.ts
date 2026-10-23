// Staff accounts and roles.
import { fail, ADMIN, ROLES, api } from '../core/http.js';
import { count } from '../core/util.js';
import { str, text, checkPassword, phoneOpt, unique, requireRow } from '../core/validate.js';
import { onAudit, row } from '../core/audit.js';
import { hashPassword } from '../core/passwords.js';
import { all, get, run, tx } from '../db/index.js';
import { safeguard } from '../services/backup.js';
import { STAFF_USERNAME_RE } from '../../shared/domain.js';

api.get('/api/users', ADMIN, () =>
  all('SELECT id, name, username, role, phone, active, created_at FROM users ORDER BY active DESC, role, name'),
);

api.post('/api/users', ADMIN, ({ body }) => {
  const username = (str(body.username) || fail(400, 'Username is required')).toLowerCase();
  if (!STAFF_USERNAME_RE.test(username)) fail(400, 'Username: 3–30 letters, numbers, dot, dash or underscore');
  if (!ROLES.includes(body.role)) fail(400, 'Invalid role');
  checkPassword(body.password);
  unique('users', 'username', username, 'Username');
  run(
    'INSERT INTO users (name, username, password, role, phone) VALUES (?,?,?,?,?)',
    text(body.name, 'Name', 60, true), username, hashPassword(body.password), body.role, phoneOpt(body.phone),
  );
});

api.put('/api/users/:id', ADMIN, ({ params, body, user }) => {
  const u = requireRow(get('SELECT * FROM users WHERE id=?', params.id), 'User');
  if (!ROLES.includes(body.role)) fail(400, 'Invalid role');
  const active = body.active === false ? 0 : 1;
  if (u.id === user.id && (body.role !== 'admin' || !active)) fail(400, 'You cannot remove your own admin access');
  tx(() => {
    run('UPDATE users SET name=?, role=?, phone=?, active=? WHERE id=?', text(body.name, 'Name', 60) || u.name, body.role, phoneOpt(body.phone), active, u.id);
    if (body.password) {
      checkPassword(body.password);
      run('UPDATE users SET password=? WHERE id=?', hashPassword(body.password), u.id);
    }
    if (!active || body.password) run('DELETE FROM sessions WHERE user_id=?', u.id);
  });
});


api.del('/api/users/:id', ADMIN, ({ params, user }) => {
  const u = requireRow(get('SELECT * FROM users WHERE id=?', params.id), 'User');
  if (u.id === user.id) fail(400, 'You cannot delete your own account');
  if (u.role === 'admin' && count("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1") <= 1) fail(400, 'Keep at least one active admin');
  safeguard();
  run('DELETE FROM users WHERE id=?', u.id); // sessions cascade; past orders keep their totals
});




onAudit('POST /api/users', { after: (c) => ['staff.create', `Created ${c.body.role} login “${String(c.body.username).toLowerCase()}” for ${c.body.name}`] });

onAudit('PUT /api/users/:id', {
  before: row('users'),
  after: (c, _r, b) => {
    const changes = [];
    if (b?.role !== c.body.role) changes.push(`role ${b?.role} → ${c.body.role}`);
    if (!!b?.active !== (c.body.active !== false)) changes.push(c.body.active === false ? 'disabled' : 're-enabled');
    if (c.body.password) changes.push('password reset');
    return ['staff.update', `Edited login of ${b?.name}${changes.length ? `: ${changes.join(', ')}` : ''}`, { id: c.params.id }];
  },
});

onAudit('DELETE /api/users/:id', { before: row('users'), after: (c, _r, b) => ['staff.delete', `Deleted login “${b?.username}” (${b?.name}, ${b?.role})`, { id: c.params.id }] });
