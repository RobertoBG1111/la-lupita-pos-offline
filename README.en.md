<!-- Idioma / Language --> [Español](README.md) · **English**

# Modelorama "La Lupita" — POS (public demo)

**A self-contained demo of a real point-of-sale system running in production.** The real
system built for the store Modelorama **"La Lupita"** (Tixpéhual, Yucatán, Mexico) runs as a
**PWA on Supabase** (Postgres + Auth + Edge Functions) and is **in daily use at the counter**.
This repository is a **demo build** of that same project, running **100% in the browser**
(IndexedDB, no backend, no credentials), so anyone can **see the real functionality without
exposing or risking the production POS**.

> Same front-end and same pricing engine as the real system; the only thing that changes is
> the **data layer** (cloud → local). That's why the demo is **faithful** to the real
> functionality with the **real catalog** (602 products) and, at the same time, **cannot
> compromise the store**: there are no credentials, no production data, and no backend to touch.
>
> *The app's UI and data field names are in Spanish (it's a Mexican store).*

![Sales screen with real-catalog search, promotions and multiple tickets](docs/img/venta.png)

---

## The problem (of the real project)

The store needed a point of sale that matched its operation: a large catalog with
**barcodes**, **inventory** control (lots and expiry / FEFO), **cash-ups** per shift and per
day, **promotions, combos and returnable containers**, and **multiple cashiers** with roles
(admin/cashier). With two constraints specific to the environment:

1. **A sale cannot stop if the internet drops.** Connectivity in the area is intermittent and
   the counter rings up sales constantly. The POS **must keep charging** with correct prices
   and promotions and **reconcile the books** once the network is back.
2. **It must be replicable per store** (multi-branch) without rebuilding the system, and
   **protect the data** (each user sees only what they should).

## The solution (the real system)

- **Installable PWA on Supabase** (Postgres + **RLS** + Auth + Edge Functions), no framework
  or bundler. It installs as a desktop app and is hosted on Vercel.
- **Critical business logic lives in the database** (triggers + the `registrar_venta` RPC):
  atomic sale, inventory depletion with **FEFO**, total = sum of subtotals, payment validation
  and returns. The app uses only the *anon key*; privacy is enforced by RLS.
- **Offline mode**: caches the catalog, **queues** sales while deducting local stock and, when
  the network returns, **re-injects them without duplicates**.
- **Multi-store** (one Supabase project per branch) and role-based **user management**.

## Why this demo build

Showing the real POS to a new client or a recruiter meant standing up a backend with
credentials and data, and **any test touched the production system** (the register of a store
that is actively operating). This build solves exactly that:

- **Same app, data layer swapped to IndexedDB.** The front-end and the pricing engine
  (`lib/ventas.js`) are **identical** to production (verified byte for byte); the screens only
  change the import `db.js → datos.js`.
- **The logic that lives on the server in production, reimplemented on the client** with the
  **same API and the same data shape** (atomic sale, FEFO, payment validation, returns), so the
  demo behaves just like the real system.
- **Real catalog seeded** on first run (exported from the production project).

**Result:** anyone can **open the app and watch the real project work** with real data, without
installing anything, without credentials and **with no way to affect the store**. Technical
detail is in [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) (Spanish).

---

## Run it (30 seconds)

It's a static app served from `app/`:

```bash
python serve.py
```

Open <http://localhost:5500>. On Windows, `Abrir POS.bat` works too.
On the **first run** it seeds only the real catalog (products, presentations, promotions and
combos) and asks you to create the **first administrator**. Then:

1. Sign in (name + password, no email).
2. Enter the shift's **opening cash float**.
3. **Sell**: scan or search by name, adjust quantities and **Charge (F4)**.
4. Reconcile in **Cash-up** and close the shift.

Being a PWA, from Chrome/Edge you can **Install** the app (desktop icon, its own window) and
keep operating offline.

---

## What it does

*These are the real system's features, all usable in this demo:*

**Sales**
- Barcode reader (global keyboard-wedge capture) and **search by name** with ↑ ↓ arrows and Enter.
- **Several open tickets at once** (park one and serve another customer · F3).
- Smart pricing: **promotions** (N × $X, automatic), **combos**, charging **six-packs/cases**
  when loose pieces add up, and **free-form sale** (code 0).
- **Returnable containers**: charges a deposit only for the empties the customer doesn't return.
- **Keyboard-only** operation: F2 search, F4 charge, F7/F8 cash drawer, + / − / ↑ ↓ / Del in the cart.
- **Stock control**: you cannot sell more than what's on hand.

**Checkout and receipts**
- Cash with **change calculation**, card and transfer; a "Justo" (exact) button and Enter to confirm.
- Printable receipt (58/80 mm), reprint and **full/partial cancellation-return** (restocks
  inventory). **Cash drawer**: money in/out.

**Cash-up** per **shift** and per **day**: total, by payment method, **expected cash in drawer**
(float + sales − payouts + pay-ins − refunds) and a breakdown by product/category.

**Inventory** — create products and presentations; **stock-in / shrinkage / adjustment** moves
(adjustment *overwrites* the real counted quantity); **lots and expiry (FEFO)**; low-stock
alerts; grouped by category; protected delete (won't delete what has already been sold).

**Administration** — Combos, Promotions and Reports (KPIs by range). Local **users** (create /
reset / deactivate, with PBKDF2 hashing). **Per-store configuration**: identity, appearance
(live colors), list of container types, receipt and rules (payment methods, rounding, packs,
who may issue returns).

**Backup** — since everything lives on this machine, there's **Export / Import** `.json` backup
and "Start from scratch". (In the cloud version, backup is handled by Supabase.)

---

## Screenshots

| Returnable containers (deposit) | Checkout with change |
|---|---|
| ![Returnable containers](docs/img/envases.png) | ![Checkout](docs/img/cobro.png) |

| Receipt with container deposit | Cash-up (shift) |
|---|---|
| ![Receipt](docs/img/ticket.png) | ![Cash-up](docs/img/corte.png) |

**Inventory** — alerts at a glance: **expired / expiring lots** and **low-stock items**:

![Inventory with lot and low-stock alerts](docs/img/inventario.png)

Per-store configuration (identity, appearance, containers, receipt, rules, users):

![Configuration](docs/img/configuracion.png)

---

## Architecture

- **Front-end**: native ES modules, no framework. Custom router, components via an `h()`
  helper, styling with design tokens (light/dark) and vendored fonts (offline).
- **Data**: `lib/almacen.js` (IndexedDB: one *object store* per "table") + `lib/datos.js`,
  which **reimplements in JS** the logic that in the cloud lives in Postgres triggers/RPC:
  atomic sale, inventory effects, FEFO, payment validation, overwriting adjustment, returns
  with restock, and cash-ups per shift/day.
- **Design boundary**: the front-end and the pricing engine (`lib/ventas.js`) are **identical**
  to the production system; only the data-layer import changes (`datos.js` ↔ `db.js`). See
  [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) (Spanish).
- **Seeding**: `lib/seed.js` loads `data/catalogo.json` (real catalog exported from production)
  and `data/config-inicial.json` (store configuration) on first run.
- **PWA**: `sw.js` (network-first precache of the shell + catalog) and `manifest.webmanifest`.
- **Data model**: each IndexedDB object store mirrors a table of the production Postgres. The
  field-by-field detail is in the [**data dictionary**](docs/DICCIONARIO_DATOS.md) (Spanish).

```
app/
  index.html, main.js         bootstrap
  config.js                   store defaults (no keys; fully local)
  lib/                        almacen (IndexedDB), datos, auth, ventas, escaner, router,
                              ui, estado (multi-ticket), config-runtime, seed, conexion/cola (stubs)
  screens/                    venta, pago, ticket, corte, inventario, combos, promociones,
                              reportes, historial, envases, configuracion, usuarios, login, bienvenida
  data/                       catalogo.json + config-inicial.json (seed)
  styles/                     tokens, base, ticket, local fonts
  sw.js, manifest.webmanifest, assets/   PWA support
docs/                         architecture + data dictionary + screenshots
serve.py, Abrir POS.bat       local static server (development only)
```

---

## Security and privacy

- **This demo** is 100% local: no network or cloud, no third-party keys in the repo, no
  production data. Passwords are stored with **PBKDF2** (Web Crypto), never in clear text. By
  design, it cannot touch the production POS.
- **The production system** protects privacy with **RLS** (enabled on every table) in Supabase
  and per-user passwords; the *service_role key* never leaves the backend.
- The only risk of local mode is losing the machine → hence the **`.json` backup**.

---
System by **Nodo Digital** · usanodo.com
