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
} from "./helpers.js";

describe("reconnect (FR-16)", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let leagueId: string;
  let draftId: string;
  let commissioner: { token: string; userId: string };
  let managerA: { token: string; userId: string };
  let teamAId: string;
  let playerIds: string[];

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestServer());
    commissioner = await createDevSession(baseUrl, "Commish");
    managerA = await createDevSession(baseUrl, "Manager A");

    const created = await createLeague(baseUrl, commissioner.token, {
      name: "Reconnect Test League",
      settings: { auctionSpots: 1, rosterSize: 1, positionGroups: null },
      teams: [{ name: "Team A" }],
    });
    leagueId = created.leagueId;
    teamAId = created.teams[0]!.id;
    await claimTeam(app, teamAId, managerA.userId);

    await addPlayers(baseUrl, commissioner.token, leagueId, [{ name: "Solo Player", position: "QB" }]);
    const playerRows = await app.db.select({ id: player.id }).from(player).where(eq(player.leagueId, leagueId));
    playerIds = playerRows.map((r) => r.id);

    const draftResult = await createDraftForLeague(baseUrl, commissioner.token, leagueId);
    draftId = draftResult.draftId;
  });

  afterAll(async () => {
    await cleanupLeague(app.db, leagueId, [commissioner.userId, managerA.userId]);
    await app.close();
  });

  it("GET /drafts/:id/state and a fresh socket join both return the same current state", async () => {
    const commish = connectSocket(baseUrl, commissioner.token);
    await waitForConnect(commish);
    try {
      await joinDraft(commish, draftId);
      await emitIntent(commish, "admin:start", {});
    } finally {
      commish.disconnect();
    }

    const res = await fetch(`${baseUrl}/drafts/${draftId}/state`, {
      headers: { authorization: `Bearer ${managerA.token}` },
    });
    expect(res.status).toBe(200);
    const httpSnapshot = (await res.json()) as { phase: string; version: number };
    expect(httpSnapshot.phase).toBe("auction");

    const socket = connectSocket(baseUrl, managerA.token);
    await waitForConnect(socket);
    try {
      const snapshotPromise = new Promise<{ phase: string; version: number }>((resolve) => {
        socket.once("state:snapshot", resolve);
      });
      await joinDraft(socket, draftId);
      const wsSnapshot = await snapshotPromise;
      expect(wsSnapshot.phase).toBe(httpSnapshot.phase);
      expect(wsSnapshot.version).toBe(httpSnapshot.version);
    } finally {
      socket.disconnect();
    }
  });

  it("resync after missing broadcasts returns a snapshot reflecting the latest state", async () => {
    const socket = connectSocket(baseUrl, managerA.token);
    await waitForConnect(socket);
    try {
      await joinDraft(socket, draftId);

      // Simulate "missed a broadcast": make progress without this socket
      // listening, then explicitly resync.
      await emitIntent(socket, "nominate", { playerId: playerIds[0] });

      const resyncSnapshotPromise = new Promise<{ lots: unknown[] }>((resolve) => {
        socket.once("state:snapshot", resolve);
      });
      const resyncAck = await new Promise<{ ok: boolean }>((resolve) => {
        socket.emit("resync", {}, resolve);
      });
      expect(resyncAck.ok).toBe(true);
      const snapshot = await resyncSnapshotPromise;
      expect(snapshot.lots).toHaveLength(1);
    } finally {
      socket.disconnect();
    }
  });

  it("a disconnect-then-reconnect restores full state via a fresh join", async () => {
    const socket1 = connectSocket(baseUrl, managerA.token);
    await waitForConnect(socket1);
    await joinDraft(socket1, draftId);
    socket1.disconnect();

    const socket2 = connectSocket(baseUrl, managerA.token);
    await waitForConnect(socket2);
    try {
      const snapshotPromise = new Promise<{ lots: unknown[]; version: number }>((resolve) => {
        socket2.once("state:snapshot", resolve);
      });
      await joinDraft(socket2, draftId);
      const snapshot = await snapshotPromise;
      expect(snapshot.lots).toHaveLength(1); // the nomination from the previous test persisted
    } finally {
      socket2.disconnect();
    }
  });
});
