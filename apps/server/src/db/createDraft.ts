import { createInitialState } from "@draft-app/engine";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "./client.js";
import { extractBookkeeping } from "./engineState.js";
import { playerFromRow, settingsFromRow, teamFromRow } from "./mappers.js";
import { draft, draftSettings, player, team } from "./schema.js";

/** Instantiates a new `draft` row for a league from its current settings/teams/players, seeded with the engine's initial state. */
export async function createDraft(db: DbOrTx, leagueId: string): Promise<string> {
  const [settingsRow] = await db.select().from(draftSettings).where(eq(draftSettings.leagueId, leagueId)).limit(1);
  if (!settingsRow) throw new Error(`draft_settings missing for league ${leagueId}`);

  const [teamRows, playerRows] = await Promise.all([
    db.select().from(team).where(eq(team.leagueId, leagueId)),
    db.select().from(player).where(eq(player.leagueId, leagueId)),
  ]);

  const settings = settingsFromRow(settingsRow);
  const teams = teamRows.map(teamFromRow);
  const players = playerRows.map(playerFromRow);
  const initialState = createInitialState(settings, teams, players);

  const [draftRow] = await db
    .insert(draft)
    .values({
      leagueId,
      phase: initialState.phase,
      auctionRound: initialState.auctionRound,
      currentLotId: null,
      currentPickNo: 1,
      paused: initialState.paused,
      breakEndsAt: null,
      version: initialState.version,
      engineState: extractBookkeeping(initialState),
    })
    .returning({ id: draft.id });

  if (!draftRow) throw new Error("Failed to create draft row");
  return draftRow.id;
}
