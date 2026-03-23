import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

export type JwtRole = "owner" | "admin" | "cashier";

export type AccessTokenClaims = {
  sub: string;
  tenant_id: string;
  role: JwtRole;
  permissions?: Record<string, boolean>;
};

const secretKey = new TextEncoder().encode(env.JWT_SECRET);

export const signAccessToken = async (claims: AccessTokenClaims) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenant_id: claims.tenant_id, role: claims.role, permissions: claims.permissions })
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
    role: payload.role as JwtRole,
    permissions: (payload.permissions ?? undefined) as Record<string, boolean> | undefined,
  } satisfies AccessTokenClaims;
};
