import type { DraftState } from "@draft-app/engine";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "./client.js";
import type { EngineBookkeeping } from "./engineState.js";
import { bidFromRow, lotFromRow, pickFromRow, playerFromRow, settingsFromRow, teamFromRow } from "./mappers.js";
import { bid, draft, draftSettings, lot, pick, player, team, teamQueue } from "./schema.js";

export class DraftNotFoundError extends Error {
  constructor(draftId: string) {
    super(`Draft not found: ${draftId}`);
    this.name = "DraftNotFoundError";
  }
}

/** Reconstructs the exact DraftState the engine expects, from Postgres. The single deserialization point. */
export async function loadDraftState(db: Db, draftId: string): Promise<DraftState> {
  const [draftRow] = await db.select().from(draft).where(eq(draft.id, draftId)).limit(1);
  if (!draftRow) throw new DraftNotFoundError(draftId);

  const [settingsRow] = await db
    .select()
    .from(draftSettings)
    .where(eq(draftSettings.leagueId, draftRow.leagueId))
    .limit(1);
  if (!settingsRow) throw new Error(`draft_settings missing for league ${draftRow.leagueId}`);

  const [teamRows, playerRows, lotRows, pickRows, bidRows] = await Promise.all([
    db.select().from(team).where(eq(team.leagueId, draftRow.leagueId)),
    db.select().from(player).where(eq(player.leagueId, draftRow.leagueId)),
    db.select().from(lot).where(eq(lot.draftId, draftId)),
    db.select().from(pick).where(eq(pick.draftId, draftId)),
    db.select().from(bid).where(eq(bid.draftId, draftId)),
  ]);

  const bookkeeping = draftRow.engineState as EngineBookkeeping;
  const queueRows = teamRows.length
    ? await db.select().from(teamQueue).where(inArray(teamQueue.teamId, teamRows.map((t) => t.id)))
    : [];
  const queues = Object.fromEntries(queueRows.map((q) => [q.teamId, (q.playerIds as string[]) ?? []]));

  return {
    settings: settingsFromRow(settingsRow),
    teams: teamRows.map(teamFromRow),
    players: playerRows.map(playerFromRow),
    phase: draftRow.phase,
    paused: draftRow.paused,
    breakEndsAt: draftRow.breakEndsAt ? draftRow.breakEndsAt.getTime() : null,
    version: draftRow.version,
    auctionRound: draftRow.auctionRound,
    lots: lotRows
      .slice()
      .sort((a, b) => a.round - b.round || a.orderInRound - b.orderInRound)
      .map(lotFromRow),
    bids: bidRows.map(bidFromRow),
    picks: pickRows.slice().sort((a, b) => a.pickNo - b.pickNo).map(pickFromRow),
    ...bookkeeping,
    // Drafts saved before these fields existed.
    commishLog: bookkeeping.commishLog ?? [],
    resumeHoldUntil: bookkeeping.resumeHoldUntil ?? null,
    revealHoldUntil: bookkeeping.revealHoldUntil ?? null,
    queues,
  };
}
