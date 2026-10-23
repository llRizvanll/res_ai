# Deploying MyretailCare

## Which option should I choose?

This app stores its data in SQLite files on disk and keeps live connections open (kitchen display, table floor).
That rules out "serverless" hosts such as Vercel, Netlify, Cloudflare Pages, and free tiers without a persistent disk
(e.g. Render free). On those your data would be wiped on every restart. Pick one of these instead:

| | Option | Monthly cost | Works when the restaurant's internet is down? | Best for |
|---|---|---|---|---|
| ⭐ **A** | **A computer in the restaurant** + free remote access (Tailscale or Cloudflare Tunnel) | **₹0** (you need a PC, an old laptop, or a mini PC at ~₹12–18k one-time) | **Yes**: billing, kitchen and tablets keep working on the shop Wi-Fi | Most single restaurants |
| **B** | **Small cloud server (VPS)** in Mumbai/Bangalore + Docker | **~₹300–600** (1 vCPU, 1–2 GB RAM) | No: the shop needs internet to bill | Several branches, owner mostly remote, no PC at the shop |
| **C** | **Oracle Cloud "Always Free"** VM + Docker | **₹0** | No | Tinkerers. Free capacity is limited and was cut in 2026, sign-up needs a card, and idle VMs can be reclaimed |

**Recommendation: Option A.** A POS must keep billing when the internet drops, and that is free. Run it on the
counter PC (or a small mini PC), let tablets and phones use it over the shop Wi-Fi, and add free remote access for
the owner. Option B is the easy "no hardware" choice if you have reliable internet and want nothing at the shop.

Need for every option: **Node.js 22.9 or newer** (or Docker). The app runs comfortably in 512 MB RAM and uses
well under 1 GB of disk for years of data plus backups.

---

## Before going live (all options)

1. **Start fresh** in Settings → Data, reset & backup. This removes the demo data; the demo stays available under
   Admin → Demo restaurant.
2. **Change every password.** The demo logins (`admin/admin123`…) are public knowledge. The dashboard warns you until
   they are changed.
3. Set **closing time** (Settings → Data) and **business details / GSTIN** (Settings).
4. Set a **second backup folder**: a USB drive, or the Google Drive / OneDrive / Dropbox folder on that computer
   (Settings → Data → "Copy backups to a second place").
5. Make sure the time zone is right (`TZ=Asia/Kolkata`, already the default in the files below).

---

## Option A — computer in the restaurant (recommended, ₹0/month)

### 1. Install

1. Install **Node.js 22 LTS** (22.9 or newer) from <https://nodejs.org>.
2. Copy this project folder to the computer (for example `C:\restaurant-pos` or `~/restaurant-pos`).
3. In that folder, run once:

```bash
npm ci
```

```bash
npm run build
```

4. Optional: copy `.env.example` to `.env` and adjust it.
5. Start it:

```bash
npm run start:prod
```

Open <http://localhost:3000> for the front page and press **Sign in**, or go straight to <http://localhost:3000/app/>.
The start-up message also prints the **Wi-Fi address** (e.g. `http://192.168.1.8:3000/app/`). Open that on tablets
and phones in the shop and bookmark it.
Tip: give the PC a fixed IP in your router (DHCP reservation) so that address never changes.

### 2. Start automatically

| Computer | How |
|---|---|
| **Windows** | Double-click `deploy\windows\install-autostart.bat` once. Set Windows to never sleep. |
| **Mac** | Follow the 3 steps at the top of `deploy/macos/com.restaurant-pos.plist`. Set "never sleep". |
| **Linux / mini PC / Raspberry Pi 5** | Copy the project to `/opt/restaurant-pos`, create a user `pos`, then follow `deploy/linux/restaurant-pos.service`. |

The built-in supervisor restarts the app within seconds if it ever crashes. A normal shutdown saves a final backup.

### 3. Owner access from home (pick one, both free)

**Tailscale: easiest and private** (nothing is exposed to the internet)
1. Install Tailscale on the restaurant PC and on the owner's phone/laptop, signed into the same account.
2. Open `http://<pc-name>:3000` (or the PC's `100.x.x.x` Tailscale address) from anywhere.
3. The free Personal plan covers up to 6 users with unlimited devices. Check Tailscale's current terms for business use.

**Cloudflare Tunnel: a normal web address with HTTPS** (e.g. `https://pos.yourrestaurant.in`)
1. Buy a domain (~₹100–1,000/year) and add it to a free Cloudflare account.
2. In Cloudflare Zero Trust → Networks → Tunnels, create a tunnel. Install `cloudflared` on the PC with the command it
   shows, and add a public hostname `pos.yourrestaurant.in → http://localhost:3000`.
3. Put `TRUST_PROXY=1` in `.env` so real visitor IPs appear in the activity log and the sign-in lock-out works per person.
4. Optional extra lock: Cloudflare Access (free for small teams) can require an email code before the page even loads.

*Just trying it?* `cloudflared tunnel --url http://localhost:3000` gives a temporary `trycloudflare.com` address without
an account. It changes every time, so it isn't suitable for daily use.

### 4. Backups

Automatic: every 30 minutes when data changes, a daily copy at closing time, and before every delete, reset or
restore. All are saved in `data/backups/`. With the Google Drive folder set as the second backup place, every
backup also reaches the cloud for free. Download the closing backup now and then too (the dashboard reminds you).

---

## Option B — cloud server with Docker (~₹300–600/month)

Any provider with a **Mumbai or Bangalore** region keeps the app snappy. Typical small plans are AWS Lightsail Mumbai,
DigitalOcean Bangalore, Hostinger KVM 1 and Contabo Mumbai. Choose 1 vCPU / 1–2 GB RAM / 20 GB+ disk, Ubuntu 24.04.
Prices change often, so compare current prices including GST and renewal rates.

### 1. Install Docker and start the app

```bash
curl -fsSL https://get.docker.com | sh
```

Copy the project to the server (e.g. `/opt/restaurant-pos`), then inside it:

```bash
cp .env.example .env
```

```bash
docker compose up -d --build
```

The app is now on `http://<server-ip>:3000`. Data lives in `./data` on the server (back it up). Check status with
`docker compose ps` and logs with `docker compose logs -f pos`.

### 2. HTTPS with your domain (pick one)

- **Caddy** (free automatic certificates): point the domain's A record at the server, install Caddy, use
  `deploy/caddy/Caddyfile`, set `TRUST_PROXY=1` in `.env`, and close port 3000 in the firewall.
- **Cloudflare Tunnel** (no open ports at all): create a tunnel as in Option A, put its token in `.env` as
  `CLOUDFLARE_TUNNEL_TOKEN=…`, set `TRUST_PROXY=1`, then run `docker compose --profile tunnel up -d`.

### 3. Off-site backups

Mount a second disk or a synced folder as `/backup-mirror` (see the comment in `docker-compose.yml`) and set
it under Settings → Data. Also download the closing backup regularly. Many VPS providers sell automatic
snapshots for a small extra fee.

---

## Option C — Oracle Cloud Always Free (₹0, with caveats)

Same steps as Option B on an Ampere (ARM) VM with Ubuntu. The image builds natively on ARM. Be aware:
- The free Ampere allowance was **reduced in 2026** (reported as 4 cores / 24 GB down to 2 cores / 12 GB). That is
  still plenty for this app. Check Oracle's current Always Free page.
- Free capacity in the Mumbai/Hyderabad regions is often unavailable at sign-up.
- Idle free VMs can be stopped and reclaimed, and a card is needed to sign up.
- Keep off-site backups. Don't rely on the free VM as the only copy of your data.

---

## Updating to a new version

1. Settings → Data → **Save backup now** (and download it).
2. Replace the code (keep the `data/` folder and `.env`).
3. Option A: `npm ci` then `npm run build`, then restart (or reboot). Option B/C: `docker compose up -d --build`.

The database upgrades itself on start. Nothing else is needed.

## Quick reference

| Task | Command |
|---|---|
| First install | `npm ci` then `npm run build` |
| Run (production) | `npm run start:prod` |
| Run without auto-restart | `node dist/server/server.js` |
| Docker | `docker compose up -d --build` |
| Health check URL | `/api/health` → `{"ok":true}` (for uptime monitors) |
| Where data lives | `data/` (databases, `backups/`, `logs/`, `restaurants/<code>/`) |
| Settings via environment | see `.env.example` |
