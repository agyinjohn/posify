# Shop POS

Small retail and wholesale POS with stock management. React (Vite) client, Node/Express API,
MongoDB, optional Cloudinary product images, installable as a PWA, and wrapped as a desktop app with Electron.

```
server/    Express + Mongoose API (also serves client/dist when built)
client/    React app (PWA)
desktop/   Electron wrapper that opens the hosted app
REQUIREMENTS.md   Feature checklist with status
```

## Run it locally

You need Node 20+ and a MongoDB (local, or a free MongoDB Atlas cluster).

```bash
# 1. API
cd server
cp .env.example .env        # fill in MONGODB_URI and JWT_SECRET (32+ chars)
npm install
# set SEED_OWNER_PASSWORD in .env, then:
npm run seed                # creates the first owner account; delete the password from .env afterwards
npm run dev                 # http://localhost:4000

# 2. Client (second terminal)
cd client
npm install
npm run dev                 # http://localhost:5173 (proxies /api to :4000)
```

Optional client env (`client/.env`): `VITE_SHOP_NAME="Kofi Traders"` prints on receipts and the sidebar.

## Deploy (web)

```bash
cd client && npm run build   # creates client/dist
cd ../server && NODE_ENV=production npm start
```
The server serves the built client, so one Node process serves both the site and the API.
Put it behind HTTPS (Render, Railway, a VPS with Caddy/Nginx). Set `CLIENT_ORIGIN` to the site URL.

## Importing products in bulk

Products page, then **Import**. Download the template, fill it in (one product per row), save it as **CSV** and choose it.
- Column titles are matched loosely: `Cost per carton`, `cost_per_ctn` and `Carton cost` all work. Unknown columns are listed and ignored.
- Prices follow the product form: give per-piece and/or per-carton prices; an empty one is worked out from the other (needs `pieces per pack`).
- Nothing is saved until you press Import: first every row is checked and you see what will be added, updated, skipped or needs fixing.
- Same SKU already in the shop: skip it, or update its details and prices (stock is never changed by an update). No SKU: one is made from the barcode or the name.
- Opening stock (in pieces or in packs) is recorded as an opening stock movement. Up to 2000 rows per file.

## Passwords

- **Change your own:** profile menu (top right), then *Change password*. Every other device you were signed in on is signed out.
- **Reset someone else's:** owner opens Users, then *Edit*, and types a temporary password. That person is signed out everywhere and must choose their own at their next sign-in.
- **Owner recovery codes (do this once, today):** profile menu, then *Recovery codes*, enter your password and make a set of 8. Save them somewhere private (password manager, or print the sheet). If you forget your password, click *Forgot your password?* on the sign-in page, enter your username, one code and a new password. Each code works once, and making a new set cancels the old one. The reset signs out every device. A red dot in the profile menu reminds you when none are set up or 2 or fewer are left.
  - Staff (cashiers) have no codes: the owner resets their password from Users.
- **Forgot the owner password and have no codes left:** only someone who controls the server can recover it.
  - **Render:**
    1. Dashboard, open the web service, then *Environment*.
    2. Add `RESET_OWNER_PASSWORD` with a temporary password (8+ characters) and save. Render restarts the service.
    3. Open *Logs* and look for `[reset] Password of owner "…" was reset`. It names the account.
    4. Sign in with that username and the temporary password. You are asked to choose your own.
    5. Delete `RESET_OWNER_PASSWORD` from the environment. (Leaving it in is harmless: the same value is applied only once.)
    - If there is more than one owner, also set `RESET_OWNER_USERNAME`.
  - **Any machine with a terminal (Render paid Shell, a VPS, your laptop):** `RESET_OWNER_PASSWORD='temporary' npm run reset-owner` in `server/`, or run `npm run reset-owner` and type it when asked.
  - Either way the account is re-activated if it was disabled, all its sessions are signed out, and the reset is written to the audit log.

## Desktop app

```bash
cd desktop && npm install
POS_URL=https://your-pos-site.example npm start   # try it
npm run dist                                       # builds the Windows installer into desktop/dist
```
For the client's machine, set the live URL in `desktop/config.default.json` before building the installer.
The desktop app needs an internet connection to reach the server (see REQUIREMENTS.md: offline mode is not built yet).

## Cloudinary (optional)
Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` to `server/.env`.
Without them the app works normally and the image upload button shows a "not set up" message.

## Design notes
- **Stock is a ledger.** `product.stock` is the running total; every change also writes a `StockMovement` row (sale, void, receipt, adjustment).
- **No oversell.** Stock is decremented with an atomic conditional update; if any line fails, earlier lines are put back.
  Standalone MongoDB has no transactions, so this is compensation-based. On Atlas/replica sets you could switch to transactions.
- **Payments are recorded, not processed.** The cashier picks Cash / MoMo / Card / Transfer. Nothing is verified with a provider.
- **Cashiers never receive cost prices** (stripped on the server, not just hidden in the UI).
- **Dates use UTC days** (Ghana is GMT year-round). Change `dayRange` in `server/src/lib/validate.js` if the shop is elsewhere.
- Tests: `cd server && npm test` (pricing and payment logic).
