import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { league, team } from "../db/schema.js";

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function assertCommissioner(db: Db, userId: string, leagueId: string): Promise<void> {
  const [row] = await db.select({ id: league.id }).from(league).where(and(eq(league.id, leagueId), eq(league.commissionerUserId, userId))).limit(1);
  if (!row) throw new ForbiddenError("Only the league commissioner can do this.");
}

/** Returns the teamId this user owns within the given league, or null if none. Never trust a client-supplied teamId. */
export async function findOwnedTeamId(db: Db, userId: string, leagueId: string): Promise<string | null> {
  const [row] = await db.select({ id: team.id }).from(team).where(and(eq(team.leagueId, leagueId), eq(team.userId, userId))).limit(1);
  return row?.id ?? null;
}

export async function assertTeamOwner(db: Db, userId: string, leagueId: string, teamId: string): Promise<void> {
  const ownedTeamId = await findOwnedTeamId(db, userId, leagueId);
  if (ownedTeamId !== teamId) throw new ForbiddenError("This team belongs to another manager.");
}
