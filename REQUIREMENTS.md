# Shop POS: Requirements and Status

Agreed scope for the retail and wholesale POS (React, Node.js, MongoDB, Cloudinary).
Update the boxes as you test and deliver.

**Legend**
- `[x]` Built and verified (unit test or automated check run)
- `[~]` Built, but not yet run against a live MongoDB, a browser, or real hardware
- `[ ]` Not built (out of the agreed scope, or phase 2)

## 1. Sales and checkout
- [~] Search products by name or SKU; barcode scanner (types code + Enter) adds to cart
- [x] Retail or wholesale price per sale; wholesale falls back to retail when no wholesale price is set
- [~] Switching retail/wholesale in the UI reprices the cart
- [~] Quantity per line and a discount on a line or on the whole sale
- [x] Discounts are clamped; zero or negative totals and bad quantities are rejected
- [~] Cashiers limited to a maximum discount % (`MAX_CASHIER_DISCOUNT_PCT`); owner can exceed it
- [x] Cashier selects how the customer paid (Cash / MoMo / Card / Transfer), including split payments
- [x] Cash overpayment becomes change; overpaying with MoMo/card/transfer is rejected
- [x] Unpaid amount is recorded as a balance owed
- [~] Credit sale requires a customer and respects their credit limit
- [~] Stock is decremented atomically and rolled back if any step fails (no overselling)
- [~] Printable receipt (browser print, 80mm layout) and reprint from Sales page
- [~] Void a sale (owner only, reason required): restores stock and customer balance, cannot be voided twice
- [x] Hold and resume a sale
- [~] Partial returns and refunds (only whole-sale void exists)

## 2. Products and stock
- [~] Add, edit and hide products: name, SKU, barcode, category, cost, retail price, wholesale price, reorder level
- [~] Cashiers never receive cost prices (removed on the server)
- [~] Opening stock on product creation
- [~] Stock changes only through recorded movements (sale, void, receipt, adjustment)
- [~] Receive stock; cost price updates to a running average
- [~] Adjust stock up or down with a mandatory reason
- [~] Low-stock and out-of-stock indicators
- [~] Product images on Cloudinary (optional; needs keys in `server/.env`)
- [~] Sell by carton and by piece (unit conversion)
- [~] Stock take (physical count with variance report)
- [~] Suppliers and purchase orders

## 3. Customers
- [~] Add and edit customers (name, phone, credit limit set by owner)
- [~] Track what each customer owes
- [~] Record a payment from a customer; cashier picks how they paid; cannot overpay the balance
- [x] Customer statements

## 4. Users and security
- [~] Sign in with username and password (bcrypt, JWT, login rate limit)
- [x] Every API route except login and health rejects requests without a valid token
- [x] MongoDB operator injection in body and query is blocked
- [~] Two roles: Owner (everything) and Cashier (sell, own sales, customers)
- [~] Owner can add users, change roles, reset passwords, disable accounts
- [x] CSV exports neutralise spreadsheet formula injection
- [~] Shift open/close cash-up (opening float, closing cash count, variance, per-method summary)
- [~] General audit log (stock movements, void records, login events, price edits, user changes)

## 5. Reports
- [~] Daily summary: sales count, total, profit, discounts, credit given, debts collected, money received per payment method
- [~] Sales by product over a date range (quantity, revenue, profit)
- [~] Stock list with value at cost; download as CSV for Excel

## 6. Platform
- [x] React client builds for production
- [~] Installable web app (PWA manifest, service worker caches the app shell)
- [~] Server serves the built client (one deployment for site and API)
- [~] Desktop app wrapper (Electron) with retry page when the server is unreachable
- [~] Offline selling with later sync (the app shell opens offline, sales queue in IndexedDB and sync on reconnect)
- [~] Automatic backups (`server/scripts/backup.sh` — `mongodump` with retention; `backup.cron` for scheduling)
- [~] Desktop auto-update

## Manual test script (run before handing over)
1. Seed the owner, sign in, add 3 products (one with no wholesale price, one with reorder level above its stock).
2. Sell one in retail and one in wholesale; check the price differs and the wholesale fallback works.
3. Pay with split Cash + MoMo; pay with cash above the total and check change; try MoMo above the total (should be refused).
4. Sell on credit to a customer; check balance, credit limit refusal, then record a payment.
5. Try to sell more than the stock (should be refused). Open two browser tabs and sell the last unit in both (only one should succeed).
6. Void a sale; check stock and customer balance return.
7. Create a cashier; confirm they cannot see cost prices, Products, Stock, Reports or Users pages, and cannot call those API routes.
8. Check the daily summary matches the till by payment method.
9. Print a receipt on the real thermal printer; scan a real barcode.
10. Build the desktop installer and run it on the client's machine.
