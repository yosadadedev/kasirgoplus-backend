export {};

import postgres from "postgres";

const hexFromBytes = (bytes: Uint8Array) => {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};

const ensureJwtSecret = async () => {
  const existing = Bun.env.JWT_SECRET;
  if (existing && existing.length >= 16) return existing;

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = hexFromBytes(bytes);

  const envPath = new URL("../../.env", import.meta.url).pathname;
  const current = await Bun.file(envPath)
    .text()
    .catch(() => "");
  const lines = current.length ? current.split(/\r?\n/) : [];

  let updated = false;
  const nextLines = lines.map((line) => {
    if (line.startsWith("JWT_SECRET=")) {
      updated = true;
      return `JWT_SECRET=${secret}`;
    }
    return line;
  });
  if (!updated) nextLines.push(`JWT_SECRET=${secret}`);

  const finalText = `${nextLines.filter((l) => l.trim().length > 0).join("\n")}\n`;
  await Bun.write(envPath, finalText);

  return secret;
};

const run = async (cmd: string[], opts?: { env?: Record<string, string | undefined> }) => {
  const proc = Bun.spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: { ...Bun.env, ...(opts?.env ?? {}) },
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`COMMAND_FAILED: ${cmd.join(" ")} (${exitCode})`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const waitForHealth = async (baseUrl: string) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.ok === true) return;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error("HEALTHCHECK_TIMEOUT");
};

const checkDbConnectivity = async (databaseUrl: string) => {
  const client = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 5 });
  try {
    await client`select 1 as ok`;
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('role "postgres" does not exist')) {
      throw new Error(
        `DB_CONNECT_FAILED: ${msg}\n` +
          `Hint: Anda pakai Homebrew Postgres, biasanya role 'postgres' tidak ada.\n` +
          `Gunakan DATABASE_URL tanpa user, contoh: postgres://127.0.0.1:5432/kasirgoplus\n` +
          `Atau pakai user macOS Anda: postgres://<mac_username>@127.0.0.1:5432/kasirgoplus`,
      );
    }
    throw new Error(`DB_CONNECT_FAILED: ${msg}`);
  } finally {
    await client.end({ timeout: 2 }).catch(() => {});
  }
};

const main = async () => {
  const port = Number(Bun.env.PORT || 8787);
  const baseUrl = (Bun.env.BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  await checkDbConnectivity(databaseUrl);

  const jwtSecret = await ensureJwtSecret();

  await run(["bun", "run", "migrate"], { env: { JWT_SECRET: jwtSecret } });
  await run(["bun", "run", "seed"], { env: { JWT_SECRET: jwtSecret } });

  const server = Bun.spawn(["bun", "src/index.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...Bun.env, PORT: String(port), JWT_SECRET: jwtSecret },
  });

  try {
    await waitForHealth(baseUrl);
    await run(["bun", "run", "smoke"], { env: { BASE_URL: baseUrl, JWT_SECRET: jwtSecret } });
  } finally {
    server.kill();
    await server.exited.catch(() => {});
  }
};

await main();
