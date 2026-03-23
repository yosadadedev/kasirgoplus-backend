import { sql } from "../db";
import { hashSecret } from "../auth/password";
import { roleDefaultPermissions } from "../rbac";

const tenantName = Bun.env.SEED_TENANT_NAME || "KasirGo+";
const ownerEmail = Bun.env.SEED_OWNER_EMAIL || "owner@kasirgo.test";
const ownerName = Bun.env.SEED_OWNER_NAME || "Owner";
const ownerPassword = Bun.env.SEED_OWNER_PASSWORD || "12345678";

const main = async () => {
  const tenantRows = (await sql`
    INSERT INTO tenants (name)
    VALUES (${tenantName})
    ON CONFLICT (name) DO NOTHING
    RETURNING id
  `) as unknown as { id: string }[];

  const existingTenant = (await sql<{ id: string }[]>`
    SELECT id FROM tenants WHERE name = ${tenantName} LIMIT 1
  `) as unknown as { id: string }[];
  const tenantId = tenantRows[0]?.id ?? existingTenant[0]?.id;
  if (!tenantId) throw new Error("FAILED_TO_CREATE_TENANT");

  const passwordHash = await hashSecret(ownerPassword);
  const perms = roleDefaultPermissions("owner");

  const userRows = (await sql`
    INSERT INTO users (tenant_id, email, name, role, status, password_hash, permissions)
    VALUES (${tenantId}, ${ownerEmail}, ${ownerName}, 'owner', 'active', ${passwordHash}, ${sql.json(perms)})
    ON CONFLICT (tenant_id, email) DO NOTHING
    RETURNING id
  `) as unknown as { id: string }[];

  const existingUser = (await sql`
    SELECT id FROM users WHERE email = ${ownerEmail} LIMIT 1
  `) as unknown as { id: string }[];
  const ownerId = userRows[0]?.id ?? existingUser[0]?.id;
  if (!ownerId) throw new Error("FAILED_TO_CREATE_OWNER");

  console.log(JSON.stringify({ tenantId, ownerId, ownerEmail }, null, 2));
  await sql.end({ timeout: 5 });
};

await main();
