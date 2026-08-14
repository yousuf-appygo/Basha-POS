# Basha Restaurant OS

Multi-branch restaurant management starter for POS billing, KOT, inventory, purchases, and owner reporting.

## Run Locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Demo Login

- Owner: `owner@basha.local` / `owner123`
- Admin: `admin@basha.local` / `admin123`
- Manager: `manager.pondy@basha.local` / `manager123`
- Cashier: `cashier.pondy@basha.local` / `cashier123`
- Kitchen: `kitchen.pondy@basha.local` / `kitchen123`

## Current MVP

- Multi-branch dashboard
- Role-based login
- Admin-only master data management
- Admin-defined roles, permissions, and user logins
- Menu/category management from seed data
- Product codes and POS search by item name/code
- POS cart with dine-in, takeaway, and delivery order types
- Direct quantity entry plus increment/decrement controls in billing
- KOT creation and kitchen status updates
- Customer bill printing for dine-in/takeaway/delivery
- KOT printing for kitchen
- Multi-payment billing
- Grocery/stock items mapped to suppliers with low-stock alerts
- Supplier bill entry with stock updates
- Nightly purchase order generation for next-day supplier delivery, with item quantities and units
- Purchase order view/print for suppliers
- Weekly/monthly supplier expense reporting
- Sales, payments, cancellations, expenses, and stock reports
- Dynamic master data for menu categories, menu items, grocery/raw material items, suppliers, branches, and tax rates
- Full-field create/edit/archive forms for master data

## Current Data Storage

The app currently uses `data/runtime.json` for storage, as originally planned for the MVP. Keep regular copies of this file while testing. We will migrate to a server database later after the restaurant workflow is stable.

## Production Roadmap

1. Finalize restaurant screens and staff workflow.
2. Add local print agent for thermal bill/KOT printers.
3. Add recipe-level inventory deduction and wastage approval flow.
4. Migrate JSON storage to PostgreSQL when ready for multi-branch hosting.
5. Add Swiggy/Zomato/ONDC integrations through aggregator adapters.
6. Add PWA offline mode for branch POS continuity.
