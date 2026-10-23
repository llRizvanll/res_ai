# Architecture

DineFlow is one TypeScript codebase with three parts: a **server** (Node, SQLite), a **browser app** (no framework, ES modules) and **shared** domain code used by both. Each part is layered, and every layer may only depend on the layers below it. `src/tests/architecture.test.ts` enforces these rules, so `npm test` fails if an import crosses a boundary.

```
src/
├─ shared/            ← used by server AND browser; depends on nothing
│  ├─ domain.ts       roles & role groups, order types, payment modes, GST slabs, stock units,
│  │                  expense categories, repeat frequencies, password rules (+ their labels)
│  ├─ calc.ts         bill maths: subtotal → discount → GST → charges → round-off; GST breakup
│  └─ benchmarks.ts   healthy food cost, margins, advice thresholds (server advice + P&L colouring)
│
├─ server/
│  ├─ config.ts       every environment variable and tunable (the only file that reads process.env)
│  ├─ server.ts       entry: prepare databases, start HTTP + background jobs, clean shutdown
│  ├─ supervisor.ts   entry for `npm start`: restarts the server if it crashes
│  ├─ reset-cli.ts    entry for `npm run reset`
│  ├─ core/           framework-level building blocks (no business rules)
│  │  ├─ http.ts        HttpError/fail, Ctx & route registry (`api.get/post/…`), body parsing, static files
│  │  ├─ dispatch.ts    one request end-to-end: body → restaurant → route → roles → handler → audit → JSON
│  │  ├─ session.ts     token → restaurant + user; password re-confirmation
│  │  ├─ events.ts      Server-Sent Events per restaurant (`broadcast('orders')`)
│  │  ├─ validate.ts    every input validator (text, numIn, dateOpt, phoneOpt, unique, refOpt, …)
│  │  ├─ audit.ts       activity log + `onAudit` rule registry
│  │  ├─ passwords.ts   scrypt hashing
│  │  ├─ log.ts         log file with rotation
│  │  └─ util.ts        todayStr, count, sqlPath
│  ├─ db/             persistence
│  │  ├─ tenants.ts     restaurant registry (incl. the built-in demo); `withTenant` / `current` pick the database
│  │  ├─ connection.ts  open with integrity check, auto-recover from newest good backup
│  │  ├─ schema.ts      tables + in-place migrations
│  │  ├─ query.ts       all/get/run/tx/exec, getSettings
│  │  └─ seed/          index (seed a restaurant) · settings (defaults) · catalog (sample menu/stock — plain data)
│  │                    · history (30 days of generated demo activity)
│  ├─ services/       business logic reused by several routes
│  │  ├─ orders.ts      loadOrder, recalc, KOTs, payment split, discount rules
│  │  ├─ backup.ts      verified snapshots, schedule, closing-time backup, rotation, off-site mirror
│  │  ├─ demo.ts        the reference demo restaurant: create, refresh weekly, reset, demo sessions
│  │  └─ finance/       calendar · recurring · pnl · series · forecast · insights (composes small metric fns) · advice
│  └─ routes/         one module per feature; each registers its endpoints AND its activity-log rules
│     auth · settings · floor · menu · kitchen · customers · inventory · reservations · expenses · finance
│     staff · reports · activity · restaurants · demo
│     orders/ lifecycle · items · billing        admin/ overview · reset · backups · health · daily
│     (index.ts loads them all)
│
├─ client/
│  ├─ app.ts          entry: sign-in vs app, demo tabs, live updates
│  ├─ config.ts       locale, quick-pick presets (notes, cancel/void reasons, discounts), kitchen/table alert
│  │                  thresholds, refresh timings
│  ├─ core/           no DOM components: api client, types, formatting, dates & periods, theme, CSV, printing
│  ├─ ui/             the UI kit, by atomic design (pages import from ui/index.ts)
│  │  ├─ atoms/         badge, status badge, veg dot, change (▲/▼) indicator
│  │  ├─ molecules/     toast + guard, empty state, form field
│  │  └─ organisms/     modal, confirm/prompt/form dialogs, bar/line charts
│  ├─ core/types/     data shapes by domain (menu, floor, orders, people, operations, app), re-exported by core/types.ts
│  ├─ features/       reusable domain widgets
│  │  ├─ data-safety/   one module per card (safety, daily backups, reset, backups) + dialogs, behind a Card contract
│  │  └─ setup-steps.ts the set-up checklist
│  ├─ shell/          nav (pages & permissions), sign-in, layout, router, branding, connection banner, demo ribbon
│  └─ views/          one page per file; bigger pages get a folder with a state.ts:
│                     pos/ · settings/ (one module per tab, SettingsTab contract) · expenses/ · pnl/ · menu/
│
├─ tests/            unit (pure logic), api (end-to-end on a throwaway server), architecture (layer rules + size budgets)
│
public/css/          app.css is a manifest; rules live in base/ · components/ · layout/ · pages/ · responsive.css
```

## Dependency rules

| Layer | May import | Must never import |
|---|---|---|
| `shared/` | — | anything in server/ or client/ |
| `server/core` | shared, config, db | services, routes |
| `server/db` | shared, config, core/log, core/passwords | services, routes, http/dispatch |
| `server/services` | shared, config, core, db | routes |
| `server/routes/*` | everything below | other route modules |
| `client/core` | shared | ui, features, shell, views |
| `client/ui` atoms → molecules → organisms | core and lower UI levels only | higher UI levels, features, views |
| `client/features` | core, ui | views, shell |
| `client/views/*` | core, ui, features, shared | other pages (a page's own sub-folder is fine) |
| server ↔ client | — | each other (share via `shared/` only) |

**Size budgets** (enforced by tests): source files ≤ 250 lines, stylesheets ≤ 150 lines. When a file nears the
limit, split it by responsibility (see how `orders/`, `admin/`, `finance/`, `settings/` and `data-safety/` are split).

## Request lifecycle (server)

1. `server.ts` hands `/api/*` to `core/dispatch.ts`.
2. The body is parsed (size-limited). `core/session.ts` picks the **restaurant** from the token prefix (`<code>.<random>`) or the sign-in body.
3. Everything after that runs inside `withTenant(...)`. `db/query.ts` helpers automatically use that restaurant's database.
4. The route is matched and its roles are checked. The handler validates input with `core/validate.ts`, uses services, and calls `broadcast()` for live screens.
5. If the route has an `onAudit` rule, an activity-log entry is written. Then the result is sent as JSON. Errors become `{ error }` with the right HTTP status.

## Extension points

- **Route guards** (`core/http.ts` `addGuard`): cross-cutting checks that run before every handler. The demo uses one
  to block anything that could reach real restaurants, backups or the file system.
- **Activity-log rules** (`core/audit.ts` `onAudit`): declare per route what gets recorded.
- **Settings tabs** (`client/views/settings/tab.ts`): add a module exporting a `SettingsTab` and list it in `index.ts`.
- **Data-tab cards** (`client/features/data-safety/card.ts`): a card renders itself and declares its own button actions.

## The demo restaurant

A separate database (`data/restaurants/demo/`) with full sample data. It is opened from **Admin → Demo restaurant** in
its own browser tab, using a tab-only session, so the real sign-in is never affected. It is hidden from the sign-in list,
never backed up, regenerated every `DEMO_REFRESH_DAYS` (default 7), and resettable from its ribbon.

## How to add a feature

1. **Shared vocabulary** (a new status, unit, category…): add it to `shared/domain.ts`, so the dropdowns and the validation stay in step.
2. **Tables**: add to `db/schema.ts`. Use `ensureColumn` in `migrate()` for columns on existing tables.
3. **Business logic** used by more than one endpoint: put it in `server/services/`.
4. **Endpoints**: create `server/routes/<feature>.ts`.
   - Use `api.get/post/put/patch/del(path, ROLES, handler)`.
   - Validate every field with `core/validate.ts`.
   - Add an `onAudit('METHOD /api/path', { after: … })` rule for anything a manager would want to see later.
   - Import the module in `routes/index.ts`.
5. **Page**: create `client/views/<page>.ts` exporting `render(el, params, ctx)` (and optionally `onEvent`). Register it in `shell/nav.ts` with its roles.
6. **UI**: reuse `ui/` components. Promote a new generic piece to the right atomic level. A domain-specific widget used by more than one page goes in `features/`.
7. **Tests**:
   - Pure logic → `tests/unit.test.ts`.
   - Behaviour → `tests/api.test.ts`. It boots its own throwaway server; never point tests at real data.
   - Run `npm test`.

## Configuration

All tunables live in `src/server/config.ts`. Set these as environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `DATA_DIR` | `./data` | databases, backups, logs |
| `SEED_DEMO` | `1` | `0` = first run creates sample setup without demo sales |
| `BACKUP_INTERVAL_MIN` | 30 | automatic backup when data changed |
| `BACKUP_MIRROR_DIR` | — | second backup folder (can also be set in Settings) |
| `CLOSING_CHECK_SEC` | 60 | how often the closing-time backup check runs |
| `LOGIN_LOCK_AFTER` / `LOGIN_LOCK_MINUTES` | 5 / 5 | wrong-password lock-out |
| `SESSION_DAYS` | 30 | sign-in session lifetime |
| `DEMO_REFRESH_DAYS` | 7 | demo restaurant data is regenerated when older than this |

Retention per backup kind, request size limits, KOT/recipe/variant limits, weak-password list and the forecast model
(history window, horizon, likely-range width, minimum data) are also in `server/config.ts`. Browser presets and timings are
in `client/config.ts`; business benchmarks in `shared/benchmarks.ts`.

## Quality gates

- `npm run typecheck`: strict TypeScript with no unused code, no implicit returns, no switch fall-through.
- `npm test`: 117 checks — 17 unit, 85 end-to-end (incl. the demo restaurant) and 15 architecture (layers + size budgets).
