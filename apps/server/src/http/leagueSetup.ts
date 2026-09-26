import { randomInt } from "node:crypto";
import { validateSettings, type DraftSettings } from "@draft-app/engine";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import type { Db, DbOrTx } from "../db/client.js";
import { draft, league, team } from "../db/schema.js";
import { isCommissioner } from "./authz.js";

/** No 0/O/1/I/L — invite codes get read aloud across a room and typed on phones. */
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newInviteCode(): string {
  let code = "";
  for (let i = 0; i < 8; i += 1) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return code;
}

/** Placeholder name for an unclaimed slot; the manager who claims it renames it. */
export function placeholderTeamName(draftNumber: number): string {
  return `Team ${draftNumber}`;
}

/**
 * Merges a partial settings override onto a base and validates the result
 * against SPEC's ranges. Returns the merged settings, or the problems found.
 */
export function mergeAndValidateSettings(base: DraftSettings, override: Record<string, unknown> | undefined): { settings: DraftSettings } | { issues: string[] } {
  const settings = { ...base, ...(override as Partial<DraftSettings> | undefined) };
  const issues = validateSettings(settings);
  return issues.length > 0 ? { issues: issues.map((i) => i.message) } : { settings };
}

/** The league's draft, if the commissioner has started one. Setup edits lock the moment it exists. */
export async function findLeagueDraft(db: DbOrTx, leagueId: string): Promise<{ id: string; phase: string } | null> {
  const [row] = await db.select({ id: draft.id, phase: draft.phase }).from(draft).where(eq(draft.leagueId, leagueId)).limit(1);
  return row ?? null;
}

/** Commissioner, or a manager who owns one of the league's teams. */
export async function isLeagueMember(db: Db, userId: string, leagueId: string): Promise<boolean> {
  if (await isCommissioner(db, userId, leagueId)) return true;
  const [row] = await db.select({ id: team.id }).from(team).where(and(eq(team.leagueId, leagueId), eq(team.userId, userId))).limit(1);
  return row !== undefined;
}

export async function leagueExists(db: Db, leagueId: string): Promise<boolean> {
  const [row] = await db.select({ id: league.id }).from(league).where(eq(league.id, leagueId)).limit(1);
  return row !== undefined;
}

/** Sends the standard 409 for any setup edit attempted after the draft exists (SPEC: settings lock when the draft starts). */
export async function rejectIfLocked(db: Db, leagueId: string, reply: FastifyReply): Promise<boolean> {
  if (await findLeagueDraft(db, leagueId)) {
    await reply.code(409).send({ error: "LOCKED", message: "The draft has started, so league setup can't change any more." });
    return true;
  }
  return false;
}

/**
 * Grows or shrinks a league's team slots to `teamCount`. Growing adds
 * placeholder slots at the end; shrinking removes unclaimed slots, highest
 * draft number first, and refuses rather than evict a manager. Draft numbers
 * are renumbered 1..N afterwards so the order stays contiguous.
 */
export async function resizeTeamSlots(tx: DbOrTx, leagueId: string, teamCount: number): Promise<{ ok: true } | { ok: false; message: string }> {
  const teams = (await tx.select({ id: team.id, draftNumber: team.draftNumber, userId: team.userId }).from(team).where(eq(team.leagueId, leagueId))).sort(
    (a, b) => a.draftNumber - b.draftNumber,
  );

  if (teamCount > teams.length) {
    const rows = [];
    for (let n = teams.length + 1; n <= teamCount; n += 1) rows.push({ leagueId, name: placeholderTeamName(n), draftNumber: n });
    await tx.insert(team).values(rows);
    return { ok: true };
  }

  if (teamCount < teams.length) {
    const removable = teams.filter((t) => t.userId === null).reverse();
    const toRemove = teams.length - teamCount;
    if (removable.length < toRemove) {
      return { ok: false, message: `Only ${removable.length} of the ${teams.length} teams are unclaimed, so the league can't shrink to ${teamCount}. Release a manager first.` };
    }
    for (const t of removable.slice(0, toRemove)) {
      await tx.delete(team).where(and(eq(team.id, t.id), isNull(team.userId)));
    }
    const remaining = teams.filter((t) => !removable.slice(0, toRemove).some((r) => r.id === t.id));
    // Two-phase renumber avoids transiently colliding with the (league_id, draft_number) unique index.
    for (const [i, t] of remaining.entries()) await tx.update(team).set({ draftNumber: -(i + 1) }).where(eq(team.id, t.id));
    for (const [i, t] of remaining.entries()) await tx.update(team).set({ draftNumber: i + 1 }).where(eq(team.id, t.id));
  }
  return { ok: true };
}
