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
