# KasirGo+ Backend

## Setup

1) Copy env

```bash
cp .env.example .env
```

Catatan:
- `bun run migrate` hanya butuh `DATABASE_URL`.
- `JWT_SECRET` dibutuhkan saat menjalankan server (`bun run dev` / `bun run start`) dan harus minimal 16 karakter.
- Internal admin bisa memakai dua mode yang kompatibel:
  - `X-Internal-Admin-Secret` untuk server-to-server/internal tooling
  - bearer token dari `POST /v1/internal-admin/auth/login` bila `ADMIN_EMAIL`, `ADMIN_PASSWORD`, dan `ADMIN_JWT_SECRET` diisi

## Postgres tanpa Docker (Mac)

### Opsi A: Postgres.app
1) Install + jalankan Postgres.app
2) Pastikan port 5432 aktif
3) Buat database:

```bash
createdb kasirgoplus
```

### Opsi B: Homebrew

```bash
brew install postgresql@16
brew services start postgresql@16
createdb kasirgoplus
```

Set `.env`:
```env
DATABASE_URL=postgres://127.0.0.1:5432/kasirgoplus
```

Lalu jalankan:
```bash
bun run migrate
bun run seed
JWT_SECRET='minimal_16_characters_secret' bun run dev
bun run smoke
```

Catatan (Homebrew Postgres):
- Biasanya user default adalah username macOS Anda, dan role `postgres` belum tentu ada.
- Gunakan format URL tanpa user/password (seperti contoh di atas), atau set user yang benar:
  `postgres://<mac_username>@127.0.0.1:5432/kasirgoplus`

## Postgres via Docker

```bash
docker compose up -d
```

PgAdmin: `http://localhost:5050` (login: `admin@kasirgo.local` / `admin`)

Koneksi Postgres (sesuai default compose):
- Host: `localhost`
- Port: `5432`
- User: `postgres`
- Password: `postgres`
- Database: `kasirgoplus`

2) Install deps

```bash
bun install
```

3) Run migrations

```bash
bun run migrate
```

4) Seed tenant + owner

```bash
bun run seed
```

5) Run dev server

```bash
bun run dev
```

Server default: `http://localhost:8787`

## Smoke test endpoints

Prereq:
- Postgres running + migrations applied
- Server running (`bun run dev`)

```bash
bun run smoke
```

## Automate: migrate → seed → dev → smoke

```bash
JWT_SECRET='minimal_16_characters_secret' bun run scenario
```

## Endpoints

### Auth
- `POST /v1/auth/login` { email, password? , pin? , deviceId? }
- `POST /v1/auth/register` { tenantName, ownerName, email, password, phone?, deviceId? }
- `POST /v1/auth/refresh` { refreshToken, deviceId? }
- `POST /v1/auth/logout` { refreshToken }
- `POST /v1/auth/request-password-reset` { email }
- `POST /v1/auth/reset-password` { token, newPassword }

### Profile
- `GET /v1/me`
- `PATCH /v1/me` { name?, phone? }
- `POST /v1/me/change-password` { oldPassword, newPassword, deviceId? }

### Catalog
- `GET /v1/categories`
- `POST /v1/categories`
- `PATCH /v1/categories/:id`
- `DELETE /v1/categories/:id`
- `GET /v1/products`
- `POST /v1/products`
- `PATCH /v1/products/:id`
- `DELETE /v1/products/:id`

### Users (RBAC)
Requires bearer access token + permission `canManageCashiers`.
- `GET /v1/users`
- `POST /v1/users`
- `PATCH /v1/users/:id`
- `POST /v1/users/:id/revoke-sessions`

### Business Settings
- `GET /v1/business-settings`
- `PATCH /v1/business-settings` (owner/manager only)
  - Payload (JSON body, semua optional, kirim yang berubah saja):
    - `businessName`: string
    - `businessAddress`: string
    - `businessPhone`: string
    - `businessEmail`: string (format email)
    - `businessCity`: string
    - `operationalOpenTime`: string `"HH:mm"` (contoh `"08:00"`)
    - `operationalCloseTime`: string `"HH:mm"` (contoh `"22:00"`)
  - Response:
    - `{ business: { businessName, businessAddress, businessPhone, businessEmail, businessCity, operationalOpenTime, operationalCloseTime, taxRate, currency, logo? } }`
  - Error codes:
    - `403 { error: "FORBIDDEN" }` (cashier)
    - `400 { error: "NO_CHANGES" }` (payload kosong)

### Printer Settings
- `GET /v1/printer-settings`
- `PATCH /v1/printer-settings`
  - Payload (JSON body, semua optional, kirim yang berubah saja):
    - `printerName`: string
    - `printerIP`: string | null
    - `printerPort`: number | null
    - `paperSize`: `"58mm"` | `"80mm"`
    - `printLogo`: boolean
    - `printerLogo`: string | null
    - `printCustomerCopy`: boolean
    - `receiptHeader`: string
    - `receiptFooter`: string
    - `showTax`: boolean
    - `showPaymentMethod`: boolean
    - `showWatermark`: boolean
    - `showSequenceNumber`: boolean
    - `showTableNumber`: boolean
    - `lastConnectedDeviceAddress`: string | null
    - `lastConnectedDeviceName`: string | null
  - Response:
    - `{ printer: { printerName, printerIP?, printerPort?, paperSize, printLogo, printerLogo?, printCustomerCopy, receiptHeader, receiptFooter, showTax, showPaymentMethod, showWatermark, showSequenceNumber, showTableNumber, lastConnectedDeviceAddress?, lastConnectedDeviceName? } }`
  - Error codes:
    - `400 { error: "NO_CHANGES" }` (payload kosong)

### Reports
Requires bearer access token + permission `canViewReports`.

- `GET /v1/reports/transactions`
  - Query params:
    - `from`: ISO datetime, wajib
    - `to`: ISO datetime, wajib
    - `limit`: number, opsional
    - `cursor`: string, opsional
    - `filterType`: `"all" | "edited" | "deleted"`, opsional
    - `paymentMethod`: metode pembayaran, opsional
    - `userId`: string, opsional. Khusus `owner`, bisa dipakai untuk memfilter transaksi berdasarkan admin/kasir tertentu.
  - Catatan akses:
    - `owner` tanpa `userId` akan melihat semua transaksi sesuai periode/filter.
    - `owner` dengan `userId` hanya akan melihat transaksi milik user tersebut.
    - `admin` / `cashier` akan selalu dibatasi ke transaksi miliknya sendiri, meskipun mengirim `userId`.

- `GET /v1/reports/transactions/count`
  - Query params:
    - `from`: ISO datetime, wajib
    - `to`: ISO datetime, wajib
    - `filterType`: `"all" | "edited" | "deleted"`, opsional
    - `paymentMethod`: metode pembayaran, opsional
    - `userId`: string, opsional. Khusus `owner`, untuk menghitung total transaksi milik admin/kasir tertentu.
  - Catatan akses:
    - Aturan visibilitas data sama seperti endpoint `/v1/reports/transactions`.

### Internal Admin
Autentikasi yang didukung:
- Header `X-Internal-Admin-Secret: <INTERNAL_ADMIN_SECRET>` untuk fallback server-to-server.
- Bearer token dari `POST /v1/internal-admin/auth/login` untuk dashboard/admin UI internal.

- `POST /v1/internal-admin/auth/login`
  - Body:
    - `email`
    - `password`
  - Response:
    - `accessToken`
    - `expiresInSeconds`
    - `admin.email`

- `GET /v1/internal-admin/users/stats`
  - Tujuan:
    - Melihat statistik user lintas tenant untuk kebutuhan super admin/internal ops.
  - Query params:
    - `from`: ISO datetime dengan offset, opsional. Filter periode transaksi/pengeluaran.
    - `to`: ISO datetime dengan offset, opsional. Filter periode transaksi/pengeluaran.
    - `tenantId`: UUID tenant, opsional.
    - `role`: `"owner" | "admin" | "cashier"`, opsional.
    - `status`: `"active" | "disabled"`, opsional.
    - `search`: string, opsional. Cari berdasarkan nama user, email, atau nama tenant.
    - `limit`: number 1-200, opsional. Default `50`.
    - `offset`: number >= 0, opsional. Default `0`.
    - `cursor`: string, opsional. Jika dikirim, endpoint akan memakai cursor pagination dan mengabaikan `offset`.
    - `sortBy`: `"createdAt" | "lastLoginAt" | "totalSales" | "totalTransactions"`, opsional. Default `totalSales`.
    - `sortOrder`: `"asc" | "desc"`, opsional. Default `desc`.
  - Response ringkas:
    - `summary.totalUsers`
    - `summary.activeUsers`
    - `summary.disabledUsers`
    - `summary.totalTransactions`
    - `summary.totalSales`
    - `summary.totalExpenses`
    - `users[]`: data user + tenant + statistik per user (`totalTransactions`, `totalSales`, `deletedTransactions`, `editedTransactions`, `kasbonTransactions`, `kasbonSales`, `totalExpenses`, `activeSessionCount`)
    - `pagination.mode`: `"offset" | "cursor"`
    - `pagination.nextCursor`: cursor untuk halaman berikutnya saat `hasMore = true`

- `POST /v1/internal-admin/users/force-password`
  - Tujuan:
    - Reset password user secara internal tanpa login sebagai tenant tersebut.

### Deploy VPS backend (pull + rebuild + migrate) 
- `cd ~/kasirgoplus-backend`
- `git pull`
- `sudo docker compose -f docker-compose.prod.yml up -d --build`
- `sudo docker exec -it kasirgoplus-backend-backend-1 sh -lc 'bun run migrate'`
- `sudo docker restart kasirgoplus-backend-backend-1`

### Deploy VPS powersync (pull + restart) 
- `cd ~/kasirgoplus-powersync`
- `git pull`
- `sudo docker compose up -d`
- `sudo docker restart kasirgoplus-powersync-powersync-1`

### Cek Log Migration
- `sudo docker exec -it kasirgoplus-postgres psql -U postgres -d kasirgoplus \
  -c "SELECT id, applied_at FROM public.migrations ORDER BY applied_at DESC;"


### Cek Kesehatan VPS
- htop
- uptime
- free -h
- df -h
