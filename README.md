# KasirGo+ Backend

## Setup

1) Copy env

```bash
cp .env.example .env
```

Catatan:
- `bun run migrate` hanya butuh `DATABASE_URL`.
- `JWT_SECRET` dibutuhkan saat menjalankan server (`bun run dev` / `bun run start`) dan harus minimal 16 karakter.

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
    - `qrisMerchantName`: string
    - `qrisActive`: boolean
  - Response:
    - `{ business: { businessName, businessAddress, businessPhone, businessEmail, businessCity, operationalOpenTime, operationalCloseTime, taxRate, currency, logo?, qrisImageUrl?, qrisMerchantName, qrisActive } }`
  - Error codes:
    - `403 { error: "FORBIDDEN" }` (cashier)
    - `400 { error: "NO_CHANGES" }` (payload kosong)
- `POST /v1/business-settings/upload-qris-image` (owner/manager only, `multipart/form-data` field `file`, max 5MB, image only)
  - Upload otomatis mengganti (dan menghapus dari R2) gambar QRIS lama jika ada.
  - Response: `{ business: {...termasuk qrisImageUrl baru...} }` (201)
  - Error codes: `503 R2_NOT_CONFIGURED`, `413 FILE_TOO_LARGE`, `400 INVALID_FILE|EMPTY_FILE|INVALID_IMAGE_TYPE`
- `POST /v1/business-settings/delete-qris-image` (owner/manager only)
  - Menghapus gambar QRIS dari R2 dan mengosongkan `qrisImageUrl`.
  - Response: `{ business: {...qrisImageUrl: undefined...} }`
- `GET|HEAD /v1/business-settings/qris-image/*` (public, proxy — bucket R2 tetap private)

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

### Internal Admin (Super Admin SaaS)
Khusus super admin, bukan untuk aplikasi mobile/landing page. Wajib header `x-internal-admin-secret` yang sama dengan env `INTERNAL_ADMIN_SECRET` (min 16 karakter, buat dengan `openssl rand -hex 32`, restart backend setelah diubah).

- `POST /v1/internal-admin/users/force-password` — ganti password user mana pun (termasuk owner) tanpa password lama.
  - Payload: pilih salah satu identifikasi user
    - `userId`: uuid, **atau**
    - `tenantId` (uuid) + `email`
    - `newPassword`: string, min 6 karakter
    - `revokeSessions`: boolean, default `true` (logout user dari semua device)
    - `reason`: string opsional, max 200 karakter (masuk log `internalAdmin.forcePassword`)
  - Response: `{ ok: true, user: { id, tenantId, email, name, role, status }, sessionsRevoked }`
  - Error codes: `503 INTERNAL_ADMIN_DISABLED` (env belum di-set), `401 UNAUTHORIZED` (secret salah), `404 NOT_FOUND`, `400` (payload tidak valid)

```bash
# Via tenantId + email
curl -X POST https://api-anda.com/v1/internal-admin/users/force-password \
  -H "Content-Type: application/json" \
  -H "x-internal-admin-secret: $INTERNAL_ADMIN_SECRET" \
  -d '{
    "tenantId": "00000000-0000-0000-0000-000000000000",
    "email": "owner@toko.com",
    "newPassword": "passwordBaru123",
    "revokeSessions": true,
    "reason": "Owner lupa password, request via WA"
  }'

# Via userId
curl -X POST https://api-anda.com/v1/internal-admin/users/force-password \
  -H "Content-Type: application/json" \
  -H "x-internal-admin-secret: $INTERNAL_ADMIN_SECRET" \
  -d '{"userId": "00000000-0000-0000-0000-000000000000", "newPassword": "passwordBaru123"}'
```

Cari `tenantId` / `userId` dari email owner:
```sql
SELECT id AS user_id, tenant_id, email, name, role, status FROM users WHERE lower(email) = 'owner@toko.com';
```

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

# Log real-time (ikuti terus)
sudo docker logs -f kasirgoplus-backend-backend-1

# 200 baris terakhir
sudo docker logs --tail 200 kasirgoplus-backend-backend-1

# Cari error aja
sudo docker logs --tail 500 kasirgoplus-backend-backend-1 2>&1 | grep -i error

# Cari log qris spesifik
sudo docker logs --tail 500 kasirgoplus-backend-backend-1 2>&1 | grep -i qris
