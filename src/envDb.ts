import { z } from "zod";

const EnvDbSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export const envDb = EnvDbSchema.parse({
  DATABASE_URL: Bun.env.DATABASE_URL,
});

