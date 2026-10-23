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
| **Expenses** | Daily expenses by category |
| **Reports** | Sales, net sales, tax, avg bill, daily & hourly charts, payment modes, order types, item & category sales, staff performance, top customers, leakage (cancels/voids/discounts), **estimated P&L** (food cost, wastage, expenses) · print & CSV |
| **Staff & roles** | Owner/Admin, Manager, Cashier, Captain/Waiter, Kitchen — each sees only their screens; enforced on the server |
| **Settings** | Restaurant profile, GSTIN/FSSAI, charges, invoice prefix/footer, loyalty rate, floor & table setup, one-click database backup |

All screens sync live (Server-Sent Events): a KOT sent from a waiter's phone pops up on the kitchen screen instantly.

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

Other scripts:

- `npm run build` — compile TypeScript (server → `dist/`, browser → `public/js/`)
- `npm run watch` — recompile browser code on save (restart `npm start` for server changes)
- `npm run typecheck` — type-check everything
- `npm run reset` — delete the database (recreated on next start)
- `SEED_DEMO=0 npm start` — first start with menu/tables only, no demo sales
- `PORT=8080 npm start` — use another port

## Project layout

```
src/
  shared/calc.ts      bill math (tax, discount, charges, round-off) used by both server and browser
  server/db.ts        SQLite schema + helpers
  server/seed.ts      sample restaurant & demo data
  server/server.ts    HTTP server, REST API, role checks, live events
  client/app.ts       login, layout, router, role-based navigation
  client/ui.ts        DOM, dialogs, forms, charts, formatting helpers
  client/print.ts     thermal bill & KOT printing
  client/views/*.ts   one file per screen
public/               index.html, css, compiled JS
data/restaurant.db    your data (back it up!)
```
