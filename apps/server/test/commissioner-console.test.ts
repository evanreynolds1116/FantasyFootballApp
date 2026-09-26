import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
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

type PresenceUpdate = { connectedTeamIds: string[] };
type Snapshot = { isCommissioner: boolean; myTeamId: string | null; connectedTeamIds: string[] };

/** Resolves with the first presence:update whose team list satisfies `predicate`. */
function waitForPresence(socket: Socket, predicate: (ids: string[]) => boolean): Promise<string[]> {
  return new Promise((resolve) => {
    const handler = (payload: PresenceUpdate) => {
      if (!predicate(payload.connectedTeamIds)) return;
      socket.off("presence:update", handler);
      resolve(payload.connectedTeamIds);
    };
    socket.on("presence:update", handler);
  });
}

async function joinAndGetSnapshot(socket: Socket, draftId: string): Promise<Snapshot> {
  const snapshot = new Promise<Snapshot>((resolve) => socket.once("state:snapshot", resolve));
  await joinDraft(socket, draftId);
  return snapshot;
}

describe("commissioner console: presence, per-viewer snapshot fields, clock changes, undo", () => {
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
      name: "Presence Test League",
      settings: { auctionSpots: 1, rosterSize: 1, positionGroups: null },
      teams: [{ name: "Team A" }, { name: "Team B" }],
    });
    leagueId = created.leagueId;
    teamAId = created.teams[0]!.id;
    teamBId = created.teams[1]!.id;
    await claimTeam(app, teamAId, managerA.userId);
    await claimTeam(app, teamBId, managerB.userId);

    await addPlayers(baseUrl, commissioner.token, leagueId, [
      { name: "Lot One Player", position: "QB" },
      { name: "Lot Two Player", position: "RB" },
      { name: "Spare Player", position: "WR" },
    ]);
    playerIds = (await app.db.select({ id: player.id }).from(player).where(eq(player.leagueId, leagueId))).map((r) => r.id);

    draftId = (await createDraftForLeague(baseUrl, commissioner.token, leagueId)).draftId;
  });

  afterAll(async () => {
    await cleanupLeague(app.db, leagueId, [commissioner.userId, managerA.userId, managerB.userId]);
    await app.close();
  });

  it("flags the commissioner, and only the commissioner, in their snapshot", async () => {
    const commish = connectSocket(baseUrl, commissioner.token);
    const socketA = connectSocket(baseUrl, managerA.token);
    await Promise.all([waitForConnect(commish), waitForConnect(socketA)]);
    try {
      const commishSnapshot = await joinAndGetSnapshot(commish, draftId);
      const snapshotA = await joinAndGetSnapshot(socketA, draftId);
      expect(commishSnapshot.isCommissioner).toBe(true);
      expect(commishSnapshot.myTeamId).toBeNull();
      expect(snapshotA.isCommissioner).toBe(false);
      expect(snapshotA.myTeamId).toBe(teamAId);
    } finally {
      commish.disconnect();
      socketA.disconnect();
    }
  });

  it("broadcasts which teams are connected as managers join and leave", async () => {
    const commish = connectSocket(baseUrl, commissioner.token);
    await waitForConnect(commish);
    try {
      const commishSnapshot = await joinAndGetSnapshot(commish, draftId);
      expect(commishSnapshot.connectedTeamIds).toEqual([]);

      const socketA = connectSocket(baseUrl, managerA.token);
      await waitForConnect(socketA);
      const aOnline = waitForPresence(commish, (ids) => ids.includes(teamAId));
      await joinDraft(socketA, draftId);
      expect(await aOnline).toEqual([teamAId]);

      // A late joiner's snapshot already carries the current list.
      const socketB = connectSocket(baseUrl, managerB.token);
      await waitForConnect(socketB);
      const snapshotB = await joinAndGetSnapshot(socketB, draftId);
      expect([...snapshotB.connectedTeamIds].sort()).toEqual([teamAId, teamBId].sort());

      const aOffline = waitForPresence(commish, (ids) => !ids.includes(teamAId));
      socketA.disconnect();
      expect(await aOffline).toEqual([teamBId]);
      socketB.disconnect();
    } finally {
      commish.disconnect();
    }
  });

  it("keeps a team online while any of its tabs is still open, and doesn't double-count a re-join", async () => {
    const commish = connectSocket(baseUrl, commissioner.token);
    const tab1 = connectSocket(baseUrl, managerA.token);
    const tab2 = connectSocket(baseUrl, managerA.token);
    await Promise.all([waitForConnect(commish), waitForConnect(tab1), waitForConnect(tab2)]);
    try {
      await joinDraft(commish, draftId);
      await joinDraft(tab1, draftId);
      await joinDraft(tab1, draftId); // re-join on the same socket must not count as a second tab
      await joinDraft(tab2, draftId);

      const afterTab2Closes = new Promise<string[]>((resolve) => commish.once("presence:update", (p: PresenceUpdate) => resolve(p.connectedTeamIds)));
      tab2.disconnect();
      expect(await afterTab2Closes).toEqual([teamAId]);

      const afterTab1Closes = waitForPresence(commish, (ids) => !ids.includes(teamAId));
      tab1.disconnect();
      expect(await afterTab1Closes).toEqual([]);
    } finally {
      tab1.disconnect();
      tab2.disconnect();
      commish.disconnect();
    }
  });

  it("accepts clock changes within SPEC's ranges and rejects anything outside them", async () => {
    const commish = connectSocket(baseUrl, commissioner.token);
    await waitForConnect(commish);
    try {
      await joinDraft(commish, draftId);

      const settingsBroadcast = new Promise<{ bid: number | "off" }>((resolve) => commish.once("settings:clocks", resolve));
      expect(await emitIntent(commish, "admin:setClocks", { bid: 45 })).toEqual({ ok: true });
      expect((await settingsBroadcast).bid).toBe(45);
      expect(await emitIntent(commish, "admin:setClocks", { pick: "off" })).toEqual({ ok: true });

      for (const payload of [{ nomination: 5 }, { nomination: 301 }, { bid: 601 }, { tie: 9 }, { pick: 700 }, { bid: 30.5 }]) {
        const res = await emitIntent(commish, "admin:setClocks", payload);
        expect(res, JSON.stringify(payload)).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
      }
    } finally {
      commish.disconnect();
    }
  });

  // Runs last: it starts the draft, which the tests above assume hasn't happened.
  it("undoing an award after the next lot has opened succeeds (one open lot per draft) and follows SPEC", async () => {
    const commish = connectSocket(baseUrl, commissioner.token);
    const socketA = connectSocket(baseUrl, managerA.token);
    const socketB = connectSocket(baseUrl, managerB.token);
    await Promise.all([waitForConnect(commish), waitForConnect(socketA), waitForConnect(socketB)]);
    try {
      await Promise.all([joinDraft(commish, draftId), joinDraft(socketA, draftId), joinDraft(socketB, draftId)]);
      expect(await emitIntent(commish, "admin:start", {})).toEqual({ ok: true });
      expect(await emitIntent(socketA, "nominate", { playerId: playerIds[0] })).toEqual({ ok: true });
      const lotOpen = new Promise<{ lotId: string }>((resolve) => commish.once("lot:open", resolve));
      expect(await emitIntent(socketB, "nominate", { playerId: playerIds[1] })).toEqual({ ok: true });
      const firstLotId = (await lotOpen).lotId;

      // Both bid, so early close resolves lot 1 after its 3 s last chance and lot 2 opens.
      const awarded = new Promise<{ lotId: string }>((resolve) => commish.once("lot:awarded", resolve));
      const nextLotOpen = new Promise<{ lotId: string }>((resolve) => commish.on("lot:open", (p: { lotId: string }) => p.lotId !== firstLotId && resolve(p)));
      expect(await emitIntent(socketA, "bid:submit", { lotId: firstLotId, amount: 50 })).toEqual({ ok: true });
      expect(await emitIntent(socketB, "bid:submit", { lotId: firstLotId, amount: 20 })).toEqual({ ok: true });
      expect((await awarded).lotId).toBe(firstLotId);
      const secondLotId = (await nextLotOpen).lotId;

      const undoSnapshot = new Promise<{ paused: boolean; picks: unknown[]; lots: { id: string; state: string; winnerTeamId: string | null }[] }>((resolve) =>
        commish.once("state:snapshot", resolve),
      );
      expect(await emitIntent(commish, "admin:undo", {})).toEqual({ ok: true });
      const snapshot = await undoSnapshot;
      expect(snapshot.paused).toBe(true);
      expect(snapshot.picks).toHaveLength(0);
      expect(snapshot.lots.find((l) => l.id === firstLotId)).toMatchObject({ state: "returnedToPool", winnerTeamId: null });
      expect(snapshot.lots.find((l) => l.id === secondLotId)?.state).toBe("open");
    } finally {
      commish.disconnect();
      socketA.disconnect();
      socketB.disconnect();
    }
  });
});
