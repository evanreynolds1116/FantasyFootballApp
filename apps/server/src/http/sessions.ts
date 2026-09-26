import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { session } from "../db/schema.js";

/** Stay signed in for 90 days on a device, then sign in again. */
export const SESSION_TTL_MS = 90 * 24 * 60 * 60_000;

/**
 * Big-board (spectator) tokens start with this. They can join a draft's
 * socket room to watch — with no team and no commissioner rights that's all
 * they can do — and every HTTP route refuses them (see requireAuth).
 */
export const SPECTATOR_TOKEN_PREFIX = "spec_";
export const SPECTATOR_TTL_MS = 2 * 24 * 60 * 60_000;

export async function createSession(db: Db, userId: string, opts: { spectator?: boolean } = {}): Promise<string> {
  const token = (opts.spectator ? SPECTATOR_TOKEN_PREFIX : "") + randomBytes(32).toString("base64url");
  const ttl = opts.spectator ? SPECTATOR_TTL_MS : SESSION_TTL_MS;
  await db.insert(session).values({ token, userId, expiresAt: new Date(Date.now() + ttl) });
  return token;
}

export async function resolveToken(db: Db, token: string): Promise<string | null> {
  const [row] = await db.select().from(session).where(eq(session.token, token)).limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return row.userId;
}
