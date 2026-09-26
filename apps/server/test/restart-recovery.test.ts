import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/buildServer.js";
import { createDb } from "../src/db/client.js";
import { player } from "../src/db/schema.js";
import {
  addPlayers,
  claimTeam,
  cleanupLeague,
  connectSocket,
  createDevSession,
  createDraftForLeague,
  createLeagueUnchecked,
  emitIntent,
  joinDraft,
  waitForConnect,
  waitForEvent,
} from "./helpers.js";

type DraftSnapshotShape = {
  lots: Array<{ id: string; state: string; endsAt: string | null }>;
  bids: Array<{ teamId: string; hasBid: boolean }>;
};

/**
 * The phase-2 acceptance criterion, literally: "restart mid-lot loses
 * nothing." Since Vitest can't kill the process running itself, this
 * simulates a restart by building/listening a second, independent
 * FastifyInstance (a fresh DB connection too, matching a real process
 * restart) against the exact same Postgres rows, after closing the first.
 */
describe("restart mid-lot loses nothing (phase 2 acceptance test)", () => {
  it(
    "a lot's state, bids, and clock survive a full server restart, and the re-armed timer still resolves it",
    async () => {
      const server1 = await buildServer({ logger: false });
      await server1.listen({ port: 0, host: "127.0.0.1" });
      const address1 = server1.server.address();
      const baseUrl1 = `http://127.0.0.1:${typeof address1 === "object" && address1 ? address1.port : 0}`;

      const commissioner = await createDevSession(baseUrl1, "Commish");
      const managerA = await createDevSession(baseUrl1, "Manager A");

      const created = await createLeagueUnchecked(server1, commissioner.userId, {
        name: "Restart Test League",
        // Generous relative to Supabase round-trip latency during setup —
        // this test verifies ordinary timer survival, not downtime recovery
        // (that's the other test below), so the clock must not plausibly
        // expire before the restart itself completes.
        settings: { auctionSpots: 1, rosterSize: 1, positionGroups: null, bidClockSec: 15, earlyClose: false },
        teams: [{ name: "Team A" }],
      });
      const leagueId = created.leagueId;
      const teamAId = created.teams[0]!.id;
      await claimTeam(server1, teamAId, managerA.userId);

      await addPlayers(baseUrl1, commissioner.token, leagueId, [{ name: "Solo Player", position: "QB" }]);
      const playerRows = await server1.db.select({ id: player.id }).from(player).where(eq(player.leagueId, leagueId));
      const playerId = playerRows[0]!.id;

      const { draftId } = await createDraftForLeague(baseUrl1, commissioner.token, leagueId);

      let server2: Awaited<ReturnType<typeof buildServer>> | null = null;
      try {
        const commish = connectSocket(baseUrl1, commissioner.token);
        const socket1 = connectSocket(baseUrl1, managerA.token);
        await Promise.all([waitForConnect(commish), waitForConnect(socket1)]);
        await Promise.all([joinDraft(commish, draftId), joinDraft(socket1, draftId)]);

        const startAck = await emitIntent(commish, "admin:start", {});
        expect(startAck.ok).toBe(true);

        const lotOpenPromise = waitForEvent<{ lotId: string }>(socket1, "lot:open");
        const nominateAck = await emitIntent(socket1, "nominate", { playerId });
        expect(nominateAck.ok).toBe(true);
        const { lotId } = await lotOpenPromise;

        const bidAck = await emitIntent(socket1, "bid:submit", { lotId, amount: 5 });
        expect(bidAck.ok).toBe(true);
        socket1.disconnect();
        commish.disconnect();

        // Confirm the bid actually landed before we "crash."
        const preRestartState = (await (
          await fetch(`${baseUrl1}/drafts/${draftId}/state`, { headers: { authorization: `Bearer ${managerA.token}` } })
        ).json()) as DraftSnapshotShape;
        expect(preRestartState.lots).toHaveLength(1);
        expect(preRestartState.lots[0]!.state).toBe("open");
        const originalEndsAt = preRestartState.lots[0]!.endsAt;
        expect(originalEndsAt).not.toBeNull();

        // "Crash": close only the listener/DB connection, and explicitly clear
        // server1's own in-process timer — a real process kill would take the
        // whole event loop (and every pending setTimeout) down with it, which
        // .close() alone doesn't simulate within one shared Vitest process.
        // Cancel the pending Node timer *before* close() — close() awaits
        // Postgres pool drainage, and the event loop keeps running timers
        // during that await. Clearing after close() left a window where an
        // elapsing clock could fire fireExpiry against server1's still-live
        // connection while server2 independently races to process the same
        // expiry, both computing the same deterministic pick id.
        server1.engineRuntime.clearTimer(draftId);
        await server1.close();

        // Rebuild from scratch: a brand-new FastifyInstance and a brand-new DB
        // connection, exactly like a real process restart.
        server2 = await buildServer({ logger: false });
        await server2.listen({ port: 0, host: "127.0.0.1" });
        const address2 = server2.server.address();
        const baseUrl2 = `http://127.0.0.1:${typeof address2 === "object" && address2 ? address2.port : 0}`;

        // Scoped to this test's draft: bootstrapScheduler recovers every live
        // draft in the (shared dev) database, including leftovers from other runs.
        const recovered = (await server2.engineRuntime.bootstrapScheduler()).filter((r) => r.draftId === draftId);
        expect(recovered).toHaveLength(0); // restarted well before the 3s clock passed — no downtime recovery needed

        const postRestartState = (await (
          await fetch(`${baseUrl2}/drafts/${draftId}/state`, { headers: { authorization: `Bearer ${managerA.token}` } })
        ).json()) as DraftSnapshotShape;
        expect(postRestartState.lots).toHaveLength(1);
        expect(postRestartState.lots[0]!.state).toBe("open");
        expect(postRestartState.lots[0]!.endsAt).toBe(originalEndsAt); // unchanged — not reset to a fresh full clock
        const bidStatus = postRestartState.bids.find((b) => b.teamId === teamAId);
        expect(bidStatus?.hasBid).toBe(true);

        // The re-armed timer (armed by bootstrapScheduler off the *original*
        // endsAt, not a fresh one) should still fire and resolve the lot on
        // its own, without any further client action.
        const socket2 = connectSocket(baseUrl2, managerA.token);
        await waitForConnect(socket2);
        const awardedPromise = waitForEvent<{ teamId: string; price: number }>(socket2, "lot:awarded");
        await joinDraft(socket2, draftId);
        const awarded = await awardedPromise;
        expect(awarded.teamId).toBe(teamAId);
        expect(awarded.price).toBe(5);
        socket2.disconnect();
      } finally {
        // A dedicated connection for cleanup — server1's may already be
        // closed by this point, and server2 may never have been built if an
        // earlier assertion threw.
        const { db: cleanupDb, client: cleanupClient } = createDb();
        await cleanupLeague(cleanupDb, leagueId, [commissioner.userId, managerA.userId]);
        await cleanupClient.end();
        if (server2) await server2.close();
      }
    },
    // Generous: setup alone can take several seconds against the free-tier
    // pooler, plus up to ~15s waiting for the re-armed timer to fire naturally.
    40_000,
  );

  it(
    "a clock that passed entirely while the server was down is extended and reported via draft:recovered",
    async () => {
      const server1 = await buildServer({ logger: false });
      await server1.listen({ port: 0, host: "127.0.0.1" });
      const address1 = server1.server.address();
      const baseUrl1 = `http://127.0.0.1:${typeof address1 === "object" && address1 ? address1.port : 0}`;

      const commissioner = await createDevSession(baseUrl1, "Commish");
      const managerA = await createDevSession(baseUrl1, "Manager A");

      const created = await createLeagueUnchecked(server1, commissioner.userId, {
        name: "Downtime Recovery League",
        settings: { auctionSpots: 1, rosterSize: 1, positionGroups: null, bidClockSec: 2, tieClockSec: 5, earlyClose: false },
        teams: [{ name: "Team A" }],
      });
      const leagueId = created.leagueId;
      const teamAId = created.teams[0]!.id;
      await claimTeam(server1, teamAId, managerA.userId);

      await addPlayers(baseUrl1, commissioner.token, leagueId, [{ name: "Solo Player", position: "QB" }]);
      const playerRows = await server1.db.select({ id: player.id }).from(player).where(eq(player.leagueId, leagueId));
      const playerId = playerRows[0]!.id;

      const { draftId } = await createDraftForLeague(baseUrl1, commissioner.token, leagueId);

      let server2: Awaited<ReturnType<typeof buildServer>> | null = null;
      try {
        const commish = connectSocket(baseUrl1, commissioner.token);
        const socket1 = connectSocket(baseUrl1, managerA.token);
        await Promise.all([waitForConnect(commish), waitForConnect(socket1)]);
        await Promise.all([joinDraft(commish, draftId), joinDraft(socket1, draftId)]);

        const startAck = await emitIntent(commish, "admin:start", {});
        expect(startAck.ok).toBe(true);

        const lotOpenPromise = waitForEvent<{ lotId: string }>(socket1, "lot:open");
        const nominateAck = await emitIntent(socket1, "nominate", { playerId });
        expect(nominateAck.ok).toBe(true);
        await lotOpenPromise;
        socket1.disconnect();
        commish.disconnect();

        // Cancel the pending Node timer *before* close() — close() awaits
        // Postgres pool drainage, and the event loop keeps running timers
        // during that await. Clearing after close() left a window where an
        // elapsing clock could fire fireExpiry against server1's still-live
        // connection while server2 independently races to process the same
        // expiry, both computing the same deterministic pick id.
        server1.engineRuntime.clearTimer(draftId);
        await server1.close();

        // Simulate real downtime: wait past the 2s bid clock before the "server" comes back.
        await new Promise((r) => setTimeout(r, 2_500));

        server2 = await buildServer({ logger: false });
        await server2.listen({ port: 0, host: "127.0.0.1" });

        const recovered = (await server2.engineRuntime.bootstrapScheduler()).filter((r) => r.draftId === draftId);
        expect(recovered).toHaveLength(1);
        expect(recovered[0]).toMatchObject({ draftId, kind: "lot" });
        expect(recovered[0]!.newEndsAt).toBeGreaterThan(Date.now());
      } finally {
        // A dedicated connection for cleanup — server1's may already be
        // closed by this point, and server2 may never have been built if an
        // earlier assertion threw.
        const { db: cleanupDb, client: cleanupClient } = createDb();
        await cleanupLeague(cleanupDb, leagueId, [commissioner.userId, managerA.userId]);
        await cleanupClient.end();
        if (server2) await server2.close();
      }
    },
    30_000,
  );
});
