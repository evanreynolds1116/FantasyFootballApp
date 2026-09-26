import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommishEdit } from "@draft-app/engine";
import { buildServer } from "../src/buildServer.js";
import { loadDraftState } from "../src/db/loadDraftState.js";
import { pick, player } from "../src/db/schema.js";
import {
  addPlayers,
  claimTeam,
  cleanupLeague,
  connectSocket,
  createDevSession,
  createDraftForLeague,
  createLeague,
  emitIntent,
  joinDraft,
  startTestServer,
  waitForConnect,
  waitForEvent,
} from "./helpers.js";

describe("commissioner edits: budget, roster, void, availability, back-in", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let leagueId: string;
  let draftId: string;
  let commissioner: { token: string; userId: string };
  let managerA: { token: string; userId: string };
  let managerB: { token: string; userId: string };
  let teamAId: string;
  let teamBId: string;
  let playerIdByName: Map<string, string>;

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestServer());
    commissioner = await createDevSession(baseUrl, "Commish");
    managerA = await createDevSession(baseUrl, "Manager A");
    managerB = await createDevSession(baseUrl, "Manager B");
    const created = await createLeague(baseUrl, commissioner.token, {
      name: "Commish Edits Test League",
      settings: { auctionSpots: 2, rosterSize: 3, positionGroups: null, startingBudget: 100, bidClockSec: 60, nominationClockSec: 60 },
      teams: [{ name: "Team A" }, { name: "Team B" }],
    });
    leagueId = created.leagueId;
    teamAId = created.teams[0]!.id;
    teamBId = created.teams[1]!.id;
    await claimTeam(app, teamAId, managerA.userId);
    await claimTeam(app, teamBId, managerB.userId);
    await addPlayers(
      baseUrl,
      commissioner.token,
      leagueId,
      ["Alpha QB", "Bravo RB", "Charlie WR", "Delta TE", "Echo WR"].map((name) => ({ name, position: name.split(" ")[1]! })),
    );
    const rows = await app.db.select({ id: player.id, name: player.name }).from(player).where(eq(player.leagueId, leagueId));
    playerIdByName = new Map(rows.map((r) => [r.name, r.id]));
    draftId = (await createDraftForLeague(baseUrl, commissioner.token, leagueId)).draftId;
  });

  afterAll(async () => {
    await cleanupLeague(app.db, leagueId, [commissioner.userId, managerA.userId, managerB.userId]);
    await app.close();
  });

  it("only the commissioner can edit; every edit reaches the room and is saved", async () => {
    const commish = connectSocket(baseUrl, commissioner.token);
    const socketA = connectSocket(baseUrl, managerA.token);
    const socketB = connectSocket(baseUrl, managerB.token);
    await Promise.all([waitForConnect(commish), waitForConnect(socketA), waitForConnect(socketB)]);
    try {
      await Promise.all([joinDraft(commish, draftId), joinDraft(socketA, draftId), joinDraft(socketB, draftId)]);
      expect(await emitIntent(commish, "admin:start", {})).toEqual({ ok: true });

      const forbidden = await emitIntent(socketA, "admin:adjustBudget", { teamId: teamAId, amount: 50, reason: "please" });
      expect(forbidden).toMatchObject({ ok: false, code: "FORBIDDEN" });

      const seenByA = waitForEvent<{ edit: CommishEdit }>(socketA, "commish:edit");
      expect(await emitIntent(commish, "admin:adjustBudget", { teamId: teamAId, amount: 25, reason: "Prize money carried over" })).toEqual({ ok: true });
      expect((await seenByA).edit).toMatchObject({ kind: "budget", teamId: teamAId, amount: 25, reason: "Prize money carried over" });

      const echo = playerIdByName.get("Echo WR")!;
      expect(await emitIntent(commish, "admin:markPlayerUnavailable", { playerId: echo })).toEqual({ ok: true });
      expect(await emitIntent(commish, "admin:markPlayerAvailable", { playerId: echo })).toEqual({ ok: true });

      // Team A nominates, wins Alpha QB for $30; the commissioner then swaps it for Delta TE at $10.
      await emitIntent(socketA, "nominate", { playerId: playerIdByName.get("Alpha QB")! });
      await emitIntent(socketB, "nominate", { playerId: playerIdByName.get("Bravo RB")! });
      let state = await loadDraftState(app.db, draftId);
      const lot1 = state.lots.find((l) => l.state === "open")!;
      const awarded = waitForEvent(socketA, "lot:awarded");
      await emitIntent(socketA, "bid:submit", { lotId: lot1.id, amount: 30 });
      await emitIntent(socketB, "bid:pass", { lotId: lot1.id });
      await awarded;

      state = await loadDraftState(app.db, draftId);
      const won = state.picks.find((p) => p.teamId === teamAId)!;
      expect(await emitIntent(commish, "admin:removePick", { pickId: won.id })).toEqual({ ok: true });
      const assigned = await emitIntent(commish, "admin:assignPlayer", { teamId: teamAId, playerId: playerIdByName.get("Delta TE")!, slot: "auction", price: 10 });
      expect(assigned).toEqual({ ok: true });

      // Lot 2 is open, so voiding it moves the draft on and returns Bravo RB to the pool.
      const lot2 = (await loadDraftState(app.db, draftId)).lots.find((l) => l.state === "open")!;
      expect(await emitIntent(commish, "admin:voidLot", { lotId: lot2.id })).toEqual({ ok: true });

      const reloaded = await loadDraftState(app.db, draftId);
      expect(reloaded.commishLog.map((e) => e.kind)).toEqual(["budget", "unavailable", "available", "remove", "assign", "void"]);
      const rows = await app.db.select().from(pick).where(eq(pick.draftId, draftId));
      expect(rows.map((r) => [r.teamId, r.playerId, r.price])).toEqual([[teamAId, playerIdByName.get("Delta TE"), 10]]);
      expect(reloaded.lots.find((l) => l.id === lot2.id)!.state).toBe("cancelled");
      // $100 + $25 adjustment − $10 for Delta TE (Alpha QB's $30 refunded).
      const { remainingBudget } = await import("@draft-app/engine");
      expect(remainingBudget(reloaded, teamAId)).toBe(115);
    } finally {
      commish.disconnect();
      socketA.disconnect();
      socketB.disconnect();
    }
  });

  it("resume sends a back-in time and pushes the clock back by it", async () => {
    const commish = connectSocket(baseUrl, commissioner.token);
    await waitForConnect(commish);
    try {
      await joinDraft(commish, draftId);
      await emitIntent(commish, "admin:pause", {});
      const before = Date.now();
      await emitIntent(commish, "admin:resume", {});
      const state = await loadDraftState(app.db, draftId);
      expect(state.resumeHoldUntil).toBeGreaterThanOrEqual(before + 10_000);
      expect(state.resumeHoldUntil).toBeLessThan(before + 12_000);
      const clock = state.nominationEndsAt ?? state.lots.find((l) => l.state === "open")?.endsAt ?? null;
      expect(clock).toBeGreaterThan(state.resumeHoldUntil!);
    } finally {
      commish.disconnect();
    }
  });
});
