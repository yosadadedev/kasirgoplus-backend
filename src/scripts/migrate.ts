import { sql } from "../db";

const migrationsDir = new URL("../migrations/", import.meta.url).pathname;

const listMigrations = async () => {
  const glob = new Bun.Glob("*.sql");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: migrationsDir })) {
    files.push(file);
  }
  return files.sort();
};

const ensureMigrationsTable = async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
};

const getApplied = async () => {
  await ensureMigrationsTable();
  const rows = await sql<{ id: string }[]>`SELECT id FROM migrations`;
  return new Set(rows.map((r: { id: string }) => r.id));
};

const applyMigration = async (id: string, content: string) => {
  await sql.begin(async (tx: any) => {
    await tx.unsafe(content);
    await tx`INSERT INTO migrations (id) VALUES (${id})`;
  });
};

const main = async () => {
  const files = await listMigrations();
  const applied = await getApplied();
  for (const file of files) {
    if (applied.has(file)) continue;
    const path = `${migrationsDir}/${file}`;
    const content = await Bun.file(path).text();
    await applyMigration(file, content);
    console.log(`applied ${file}`);
  }
  await sql.end({ timeout: 5 });
};

await main();
