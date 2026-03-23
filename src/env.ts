import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  PASSWORD_RESET_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 30),
  RETURN_RESET_TOKEN: z.coerce.boolean().default(true),
  POWERSYNC_JWT_AUDIENCE: z.string().min(1).default("powersync"),
  POWERSYNC_JWT_KID: z.string().min(1).default("kasirgo-hs256"),
  HOSTNAME: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8787),
});

export const env = EnvSchema.parse({
  DATABASE_URL: Bun.env.DATABASE_URL,
  JWT_SECRET: Bun.env.JWT_SECRET,
  ACCESS_TOKEN_TTL_SECONDS: Bun.env.ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS: Bun.env.REFRESH_TOKEN_TTL_SECONDS,
  PASSWORD_RESET_TOKEN_TTL_SECONDS: Bun.env.PASSWORD_RESET_TOKEN_TTL_SECONDS,
  RETURN_RESET_TOKEN: Bun.env.RETURN_RESET_TOKEN,
  POWERSYNC_JWT_AUDIENCE: Bun.env.POWERSYNC_JWT_AUDIENCE,
  POWERSYNC_JWT_KID: Bun.env.POWERSYNC_JWT_KID,
  HOSTNAME: Bun.env.HOSTNAME,
  PORT: Bun.env.PORT,
});
