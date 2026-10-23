# DineFlow — Restaurant Management Software

A complete, browser-based restaurant system for small and medium restaurants, written in **TypeScript**.
One small Node.js server runs on the counter PC; every device on the same Wi-Fi (billing PC, captain phones,
kitchen tablet) just opens it in a browser. No payment gateway — payments are recorded, not charged.

## Features

| Area | What you get |
|---|---|
| **Billing / POS** | Dine-in, takeaway, delivery · category + search + short-code entry · variants (Half/Full) · cooking notes · discounts (flat / %) · GST (CGST+SGST) · service & packaging charge · round-off · cash / card / UPI / split settlement with change calculator · 80mm thermal bill & KOT printing |
| **Tables** | Live floor plan by area · free / running / bill printed / overdue colours · move table · running takeaway & delivery orders |
| **Kitchen Display (KDS)** | Live KOT board (New → Preparing → Ready → Served) · timers with late alerts · sound on new KOT · voided items shown · mark dishes out of stock |
| **Orders** | Search & filter history · order detail · reprint · cancel with reason · CSV export |
| **Reservations** | Bookings by date · assign tables · seat (opens POS) / no-show / cancel |
| **Customers (CRM)** | Auto-created from POS · visits, spend, loyalty points, favourite dishes, birthdays · CSV export |
| **Menu** | Categories, items, GST rate, veg/non-veg, variants, availability, **recipes** (raw material per plate) |
| **Inventory** | Raw materials, stock value, low-stock alerts · purchase, wastage, physical count · **auto-deduction on every bill** via recipes · movement log |
| **Expenses** | Day / week / month / year / custom views with ‹ › navigation, comparison with the previous period, by-day or by-month charts and category split · **recurring expenses** (daily, weekly, monthly, quarterly, yearly) posted automatically on their due date — rent, salaries, EMIs, subscriptions |
| **Profit & Loss** | Proper P&L statement for any month, quarter, year or range: gross sales → discounts → net sales → other income → revenue, cost of goods (recipe food cost + wastage), gross profit, operating expenses by category, net profit and margins · compared with the previous period or the same period last year · month-by-month table and chart for the year · CSV & print |
| **Growth & insights** | 90-day sales forecast with likely range (trend × weekday pattern), projected month-end sales/expenses/profit, break-even point and safety margin, next-3-months outlook, 12-month trend, best/worst weekdays and hours, rising/falling dishes, channel and customer growth, and plain-language suggestions |
| **Reports** | Sales, net sales, tax, avg bill, daily & hourly charts, payment modes, order types, item & category sales, staff performance, top customers, leakage (cancels/voids/discounts), **estimated P&L** (food cost, wastage, expenses) · print & CSV |
| **Staff & roles** | Owner/Admin, Manager, Cashier, Captain/Waiter, Kitchen — each sees only their screens; enforced on the server |
| **Branding & theme** | Your restaurant name, tagline and logo on the sign-in page, sidebar, browser tab and printed bills · 11 brand colours or any custom colour · light / dark / match-device appearance, with a per-device override in the user menu |
| **Getting started** | Demo banner + step-by-step setup checklist (branding, business details, billing, tables, menu, inventory, staff, admin password) with progress |
| **Reset & delete** | **Start fresh** erases all demo data and keeps only your login · or clear just what you choose (orders, customers, reservations, expenses, stock log, stock levels, inventory, menu, tables, staff, settings, branding) · type RESET + password to confirm · bulk-delete menu items & customers · delete staff accounts and individual bills (stock & customer totals are reversed) |
| **Backups** | Automatic backup before every reset/restore · save backups any time · restore, download or delete them from Settings |
| **Demo restaurant** | Admin → Demo restaurant opens a fully set-up sample restaurant in its own tab, any time, for reference or to try things. It never touches your data, isn't backed up, refreshes weekly and can be reset in one click — so your real restaurant can start fresh while the demo stays available. |
| **Multiple restaurants** | Settings → Restaurants: add branches, each with its own staff logins, menu, tables, stock, customers, reports, activity log and backups. Staff pick their restaurant on the sign-in page. Removing a branch archives its folder (never deletes). |
| **Activity log** | Every sign-in (incl. failed), KOT, discount, void, bill, settlement, cancellation, delete, stock change, staff/settings change, reset and backup — with who, when, amount and device. Per-account daily summary (sales, voids, discounts, cancels). CSV export. Survives backup restores. |
| **Settings** | Restaurant profile, GSTIN/FSSAI, charges, invoice prefix/footer, loyalty rate, floor & table setup, one-click database backup |

All screens sync live (Server-Sent Events): a KOT sent from a waiter's phone pops up on the kitchen screen instantly.

## Data safety

Your bills, stock and order history are protected at several levels:

| Risk | Protection |
|---|---|
| Crash or power cut while billing | Every save is committed straight to disk (SQLite WAL + full sync). A settled bill is never half-written. |
| Server process crashes | `npm start` runs a supervisor that saves a backup and restarts the server within seconds. Errors go to `data/logs/`. |
| Database file gets damaged | Checked on every start. A damaged file is set aside (`restaurant.damaged-…db`) and the newest **verified** backup is restored automatically; the owner sees a warning. |
| Mistakes (wrong delete, reset) | A backup is taken automatically before every delete, reset and restore, and can be restored from Settings. |
| End of day | A **closing-time backup** (time set by the owner, default 23:30) every day, kept for a year. Settings shows a daily table — bills, sales, which accounts worked, the backup, and who downloaded it. The dashboard reminds the owner until today's backup is downloaded. |
| Losing recent work | Automatic backups every 30 min when anything changed, a daily copy kept 90 days, plus start-up and shut-down copies. Every backup is integrity-checked after saving. |
| The computer's disk dies | Settings → Data, reset & backup → **Copy backups to a second place**: pick a USB drive or a Google Drive / OneDrive / Dropbox folder and every backup is copied there too. |
| Wi-Fi drops on a tablet | A red banner warns staff, items not yet sent to the kitchen are kept on the device (even after refresh), and re-sending never creates duplicate orders or KOTs. |

The dashboard warns the owner if a backup fails, no backup was made in 24 h, or the off-site copy stops working.
Settings → Data, reset & backup shows the status and has a **Run full check** button.

Recommended: set the off-site folder on day one, and use `npm start` (not `start:once`) on the shop computer.

## Run it

Requires **Node.js 22.5+** (uses the built-in `node:sqlite`, so there are no native dependencies).

```bash
npm install
npm start
```

Open http://localhost:3000. The server also prints a LAN address (e.g. `http://192.168.1.8:3000`) for tablets/phones.
On first start a database with a sample restaurant and 30 days of demo sales is created in `data/`.

| Role | Username | Password |
|---|---|---|
| Owner / Admin | `admin` | `admin123` |
| Manager | `manager` | `manager123` |
| Cashier | `cashier` | `cashier123` |
| Captain / Waiter | `waiter` | `waiter123` |
| Kitchen | `kitchen` | `kitchen123` |

Change these passwords (Staff & Roles) before real use.

**Going live:** explore the demo, then open **Getting started** (or Settings → Data, reset & backup) and click
**Start fresh**. The demo is kept as a backup, and the checklist walks you through setting up your own restaurant.

## Quality checks

`npm test` runs 117 checks: 17 unit tests on the bill maths and validators, 85 end-to-end checks on a throwaway server (demo restaurant, sign-in and lock-out, every role's permissions, input validation, bill totals, split payments, stock, retry safety, restaurant isolation, backups, reset & restore, recurring expenses, P&L and forecasts) and 15 architecture checks that keep the code layering intact and every file within its size budget. It never touches your real data.

Other scripts:

- `npm run build` — compile TypeScript (server → `dist/`, browser → `public/js/`)
- `npm run watch` — recompile browser code on save (restart `npm start` for server changes)
- `npm run typecheck` — type-check everything
- `npm run reset [code]` — start a restaurant over with demo data (its current data is saved as a backup first; backups are never deleted)
- `npm run start:once` — run without the auto-restart supervisor
- `BACKUP_INTERVAL_MIN=15 npm start` — back up more often; `BACKUP_MIRROR_DIR=/path` — off-site folder without using the UI
- `SEED_DEMO=0 npm start` — first start with menu/tables only, no demo sales
- `PORT=8080 npm start` — use another port

## Project layout

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full picture: layers, dependency rules, request lifecycle, how to add a feature, and configuration.

```
src/shared/   domain vocabulary + bill maths (used by server and browser)
src/server/   config · core (http, sessions, validation, audit) · db · services · routes (one per feature)
src/client/   core · ui (atoms → molecules → organisms) · features · shell · views (pages)
src/tests/    unit · end-to-end API · architecture rules
data/         restaurant.db, backups/, logs/, restaurants/<code>/ (extra branches)
```
