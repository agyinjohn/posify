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
