import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

export type JwtRole = "owner" | "admin" | "cashier";

export type AccessTokenClaims = {
  sub: string;
  tenant_id: string;
  sid?: string;
  role: JwtRole;
  permissions?: Record<string, boolean>;
  retention_days?: string[];
};

const secretKey = new TextEncoder().encode(env.JWT_SECRET);

const RETENTION_DAYS = 30;

const toDayString = (d: Date) => {
  return d.toISOString().slice(0, 10);
};

const makeRetentionDays = (days: number) => {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    out.push(toDayString(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return out;
};

export const signAccessToken = async (claims: AccessTokenClaims) => {
  const now = Math.floor(Date.now() / 1000);
  const retentionDays =
    Array.isArray(claims.retention_days) && claims.retention_days.length > 0
      ? claims.retention_days
      : makeRetentionDays(RETENTION_DAYS);
  return new SignJWT({
    tenant_id: claims.tenant_id,
    sid: claims.sid,
    role: claims.role,
    permissions: claims.permissions,
    retention_days: retentionDays,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: env.POWERSYNC_JWT_KID })
    .setSubject(claims.sub)
    .setAudience(env.POWERSYNC_JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + env.ACCESS_TOKEN_TTL_SECONDS)
    .sign(secretKey);
};

export const verifyAccessToken = async (token: string) => {
  const verified = await jwtVerify(token, secretKey);
  const payload = verified.payload as any;
  return {
    sub: String(payload.sub),
    tenant_id: String(payload.tenant_id),
    sid: payload.sid ? String(payload.sid) : undefined,
    role: payload.role as JwtRole,
    permissions: (payload.permissions ?? undefined) as Record<string, boolean> | undefined,
    retention_days: Array.isArray(payload.retention_days)
      ? payload.retention_days.map((x: any) => String(x)).filter(Boolean)
      : undefined,
  } satisfies AccessTokenClaims;
};
