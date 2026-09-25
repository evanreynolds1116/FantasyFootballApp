import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { session } from "../db/schema.js";

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(session).values({ token, userId });
  return token;
}

export async function resolveToken(db: Db, token: string): Promise<string | null> {
  const [row] = await db.select().from(session).where(eq(session.token, token)).limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return row.userId;
}
