import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/buildServer.js";
import { player } from "../src/db/schema.js";
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

/** Recursively scans a value for any key literally named "amount". */
function containsAmountKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAmountKey);
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === "amount") return true;
      if (containsAmountKey(v)) return true;
    }
  }
  return false;
}

describe("bid secrecy (network level)", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let leagueId: string;
  let draftId: string;
  let commissioner: { token: string; userId: string };
  let managerA: { token: string; userId: string };
  let managerB: { token: string; userId: string };
  let teamAId: string;
  let teamBId: string;
  let playerIds: string[];

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestServer());
    commissioner = await createDevSession(baseUrl, "Commish");
    managerA = await createDevSession(baseUrl, "Manager A");
    managerB = await createDevSession(baseUrl, "Manager B");

    const created = await createLeague(baseUrl, commissioner.token, {
      name: "Secrecy Test League",
      settings: { auctionSpots: 1, rosterSize: 1, positionGroups: null },
      teams: [{ name: "Team A" }, { name: "Team B" }],
    });
    leagueId = created.leagueId;
    teamAId = created.teams[0]!.id;
    teamBId = created.teams[1]!.id;
    await claimTeam(app, teamAId, managerA.userId);
    await claimTeam(app, teamBId, managerB.userId);

    await addPlayers(baseUrl, commissioner.token, leagueId, [
      { name: "Star Player", position: "QB" },
      { name: "Second Player", position: "QB" },
    ]);
    const playerRows = await app.db.select({ id: player.id }).from(player).where(eq(player.leagueId, leagueId));
    playerIds = playerRows.map((r) => r.id);

    const draftResult = await createDraftForLeague(baseUrl, commissioner.token, leagueId);
    draftId = draftResult.draftId;
  });

  afterAll(async () => {
    await cleanupLeague(app.db, leagueId, [commissioner.userId, managerA.userId, managerB.userId]);
    await app.close();
  });

  it("never broadcasts a hidden amount to a non-winning bidder before reveal", async () => {
    const socketA = connectSocket(baseUrl, managerA.token);
    const socketB = connectSocket(baseUrl, managerB.token);
    await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);
    await Promise.all([joinDraft(socketA, draftId), joinDraft(socketB, draftId)]);

    const commish = connectSocket(baseUrl, commissioner.token);
    await waitForConnect(commish);

    try {
      await joinDraft(commish, draftId);
      await emitIntent(commish, "admin:start", {});

      // Collect every broadcast socketB receives from the moment it's socketA's
      // turn to nominate through to the bid being submitted.
      const receivedByB: { event: string; payload: unknown }[] = [];
      socketB.onAny((event: string, payload: unknown) => receivedByB.push({ event, payload }));

      const nominateResA = await emitIntent(socketA, "nominate", { playerId: playerIds[0] });
      expect(nominateResA.ok).toBe(true);

      const lotOpenPromise = waitForEvent<{ lotId: string }>(socketB, "lot:open");
      const nominateResB = await emitIntent(socketB, "nominate", { playerId: playerIds[1] });
      expect(nominateResB.ok).toBe(true);

      const lotOpen = await lotOpenPromise;
      const bidRes = await emitIntent(socketA, "bid:submit", { lotId: lotOpen.lotId, amount: 42 });
      expect(bidRes.ok).toBe(true);

      // Give the lot:bidStatus broadcast a moment to arrive.
      await new Promise((r) => setTimeout(r, 200));

      const bidStatusEvents = receivedByB.filter((e) => e.event === "lot:bidStatus");
      expect(bidStatusEvents.length).toBeGreaterThan(0);
      for (const e of bidStatusEvents) {
        expect(containsAmountKey(e.payload)).toBe(false);
        expect(e.payload).toMatchObject({ hasBid: true });
        expect(Object.keys(e.payload as object).sort()).toEqual(["hasBid", "lotId", "teamId", "type", "version"].sort());
      }

      // The full event stream socketB received before reveal never leaked an amount.
      for (const e of receivedByB) {
        if (e.event === "lot:reveal" || e.event === "lot:tieRebidRevealed") continue;
        expect(containsAmountKey(e.payload), `event ${e.event} leaked an amount`).toBe(false);
      }
    } finally {
      socketA.disconnect();
      socketB.disconnect();
      commish.disconnect();
    }
  });

  it("a rejected bid's private ack is never broadcast to other sockets", async () => {
    const socketA = connectSocket(baseUrl, managerA.token);
    const socketB = connectSocket(baseUrl, managerB.token);
    await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);

    try {
      await Promise.all([joinDraft(socketA, draftId), joinDraft(socketB, draftId)]);

      const receivedByB: { event: string; payload: unknown }[] = [];
      socketB.onAny((event: string, payload: unknown) => receivedByB.push({ event, payload }));

      // An invalid bid (below minBid) on a lot socketA isn't even eligible for
      // anymore in this draft's current state is fine to attempt — we only
      // care that whatever ack code comes back is never broadcast.
      await emitIntent(socketA, "bid:submit", { lotId: "not-a-real-lot", amount: 1 });
      await new Promise((r) => setTimeout(r, 200));

      expect(receivedByB.some((e) => e.event === "draft:rejected")).toBe(false);
    } finally {
      socketA.disconnect();
      socketB.disconnect();
    }
  });
});
