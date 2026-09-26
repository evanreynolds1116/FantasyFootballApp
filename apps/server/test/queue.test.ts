import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import { buildServer } from "../src/buildServer.js";
import { player, user } from "../src/db/schema.js";
import { cleanupLeague, connectSocket, createDevSession, joinDraft, startTestServer, waitForConnect } from "./helpers.js";

type Session = { token: string; userId: string };

describe("manager queue (FR-19): lobby, draft, privacy, persistence", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let commish: Session;
  let alice: Session;
  let bob: Session;
  let leagueId: string;
  let inviteCode: string;
  let playerIds: string[];

  const call = async (method: string, path: string, who: Session, body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${who.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
  };
  const snapshotOf = (s: Socket) =>
    new Promise<Record<string, any>>((resolve) => {
      s.once("state:snapshot", resolve);
      s.emit("resync", {}, () => {});
    });

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestServer());
    commish = await createDevSession(baseUrl, "Queue Commish");
    alice = await createDevSession(baseUrl, "Queue Alice");
    bob = await createDevSession(baseUrl, "Queue Bob");
    const created = await call("POST", "/leagues", commish, {
      name: "Queue Test League",
      settings: { teamCount: 3, auctionSpots: 1, rosterSize: 2, positionGroups: null, nominationClockSec: 300 },
    });
    leagueId = created.body.leagueId;
    const league = (await call("GET", `/leagues/${leagueId}`, commish)).body;
    inviteCode = league.inviteCode;
    await call("POST", `/invites/${inviteCode}/claim`, commish, { teamId: league.teams[0].id });
    await call("POST", `/invites/${inviteCode}/claim`, alice, { teamId: league.teams[1].id });
    await call("POST", `/invites/${inviteCode}/claim`, bob, { teamId: league.teams[2].id });
    await call("POST", `/leagues/${leagueId}/players`, commish, { players: Array.from({ length: 8 }, (_, i) => ({ name: `Queue Player ${i + 1}`, position: "WR" })) });
    playerIds = (await app.db.select({ id: player.id }).from(player).where(eq(player.leagueId, leagueId))).map((r) => r.id);
  });

  afterAll(async () => {
    await cleanupLeague(app.db, leagueId, []);
    for (const u of [commish, alice, bob]) await app.db.delete(user).where(eq(user.id, u.userId));
    await app.close();
  });

  it("lets each manager build their own queue in the lobby — and only their own", async () => {
    expect((await call("PUT", `/leagues/${leagueId}/queue`, alice, { playerIds: [playerIds[3], playerIds[1], playerIds[3]] })).status).toBe(200);
    expect((await call("GET", `/leagues/${leagueId}/queue`, alice)).body.playerIds).toEqual([playerIds[3], playerIds[1]]);
    expect((await call("GET", `/leagues/${leagueId}/queue`, bob)).body.playerIds).toEqual([]);

    const outsider = await createDevSession(baseUrl, "Queue Outsider");
    expect((await call("GET", `/leagues/${leagueId}/queue`, outsider)).status).toBe(403);
    await app.db.delete(user).where(eq(user.id, outsider.userId));

    const foreign = "00000000-0000-4000-8000-000000000000";
    expect((await call("PUT", `/leagues/${leagueId}/queue`, alice, { playerIds: [foreign] })).body.error).toBe("INVALID_QUEUE");
  });

  it("carries the lobby queue into the draft, shows it only to its owner, and keeps it private on the wire", async () => {
    const draftId = (await call("POST", `/leagues/${leagueId}/start`, commish)).body.draftId as string;
    const aliceTab1 = connectSocket(baseUrl, alice.token);
    const aliceTab2 = connectSocket(baseUrl, alice.token);
    const bobSock = connectSocket(baseUrl, bob.token);
    try {
      await Promise.all([waitForConnect(aliceTab1), waitForConnect(aliceTab2), waitForConnect(bobSock)]);
      await Promise.all([joinDraft(aliceTab1, draftId), joinDraft(aliceTab2, draftId), joinDraft(bobSock, draftId)]);

      expect((await snapshotOf(aliceTab1)).myQueue).toEqual([playerIds[3], playerIds[1]]);
      const bobSnap = await snapshotOf(bobSock);
      expect(bobSnap.myQueue).toEqual([]);
      expect(bobSnap).not.toHaveProperty("queues");

      const bobEvents: string[] = [];
      bobSock.onAny((ev: string) => bobEvents.push(ev));
      const tab2Private = new Promise<{ queue: string[] }>((r) => aliceTab2.once("you:private", r));
      const ack = await new Promise<{ ok: boolean }>((r) => aliceTab1.emit("queue:update", { playerIds: [playerIds[5], playerIds[3]] }, r));
      expect(ack.ok).toBe(true);
      expect((await tab2Private).queue).toEqual([playerIds[5], playerIds[3]]); // her other tab stays in sync
      await new Promise((r) => setTimeout(r, 300));
      expect(bobEvents.filter((e) => e === "you:private" || e === "queue:updated")).toEqual([]);

      // A lobby edit after the start goes through the engine, so the live draft sees it too.
      const viaHttp = new Promise<{ queue: string[] }>((r) => aliceTab1.once("you:private", r));
      expect((await call("PUT", `/leagues/${leagueId}/queue`, alice, { playerIds: [playerIds[6]] })).status).toBe(200);
      expect((await viaHttp).queue).toEqual([playerIds[6]]);

      // Saved: a fresh load from the database (as after a restart) has it.
      const fromDb = await app.db.query.teamQueue.findMany();
      expect(fromDb.some((q) => JSON.stringify(q.playerIds) === JSON.stringify([playerIds[6]]))).toBe(true);
      expect((await call("GET", `/drafts/${draftId}/state`, alice)).body.myQueue).toEqual([playerIds[6]]);
      expect((await call("GET", `/drafts/${draftId}/state`, bob)).body.myQueue).toEqual([]);
    } finally {
      aliceTab1.disconnect();
      aliceTab2.disconnect();
      bobSock.disconnect();
    }
  });
});
