# Jewellery Management System

Node.js (Express) API + React (Vite, MUI) frontend + MySQL 8.

```
database/schema.sql   full database design (tables, seed data, views)
backend/              REST API  -> http://localhost:5000/api
frontend/             React app -> http://localhost:5173
```

## First-time setup

1. Make sure MySQL is running (WAMP: port 3306, user `root`, no password).
2. Backend:
   ```bash
   cd backend
   cp .env.example .env      # then set JWT_SECRET to a long random string
   npm install
   npm run db:init           # creates the jewellery_system database
   npm run db:seed           # creates the "admin" user (password = ADMIN_PASSWORD in .env)
   npm run dev
   ```
3. Frontend (second terminal):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
4. Open http://localhost:5173 and log in as `admin`. You will be asked to choose a new password.

`npm run db:fresh` deletes the database and creates it again from `database/schema.sql`.

### Database updates (migrations)

Changes to an existing database live in `database/migrations/` (one `.sql` file each, named `YYYY-MM-DD-what.sql`).
The `schema_migrations` table records which ones a database has had, so each runs only once.

```bash
cd backend
npm run db:migrate                 # run every migration this database hasn't had yet
npm run db:migrate -- --status     # list applied / pending, change nothing
npm run db:migrate -- --mark-all   # record all as applied WITHOUT running them
npm run db:migrate -- --mark <file.sql>   # record one as applied without running it
```

- A new database (`db:init` / `db:fresh`) records every current migration as applied, because `schema.sql` already has them.
- A database you updated by hand before this existed: run `--mark-all` once, then use `db:migrate` from then on.
- When you change the database: add a new migration file **and** make the same change in `schema.sql`.

## Modules

| # | Module | Status |
|---|--------|--------|
| 1 | Login, users, roles & permissions, activity log | Done |
| 2 | Karats & daily gold price setup | Done |
| 3 | Categories & items (with barcode tags) | Done |
| 4 | Suppliers & purchases (+ supplier payments) | Done |
| 5 | Craftsmen & craft jobs (+ gold / cash account) | Done |
| 6 | Customers, sales / billing, payments & credit | Done |
| 7 | Reports (sales, profit, stock, wastage, balances) | Done |

## How permissions work

- Every user has one **role**; a role is a set of permissions (`sales.create`, `gold_prices.update`, ...).
- A user can also have **exceptions**: extra permissions (Allow) or removed ones (Block).
- The **Admin** role always has every permission.
- The API checks permissions on every request; the menu and buttons hide what a user cannot do.
- After 5 wrong passwords an account is locked for 15 minutes (changeable in the `settings` table).
