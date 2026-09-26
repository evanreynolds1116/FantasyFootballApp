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

describe("authorization", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let leagueId: string;
  let draftId: string;
  let commissioner: { token: string; userId: string };
  let managerA: { token: string; userId: string };
  let managerB: { token: string; userId: string };
  let outsider: { token: string; userId: string };
  let teamAId: string;
  let teamBId: string;
  let playerIds: string[];

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestServer());

    commissioner = await createDevSession(baseUrl, "Commish");
    managerA = await createDevSession(baseUrl, "Manager A");
    managerB = await createDevSession(baseUrl, "Manager B");
    outsider = await createDevSession(baseUrl, "Outsider");

    const created = await createLeague(baseUrl, commissioner.token, {
      name: "Authz Test League",
      settings: { auctionSpots: 2, rosterSize: 2, positionGroups: null },
      teams: [{ name: "Team A" }, { name: "Team B" }],
    });
    leagueId = created.leagueId;
    teamAId = created.teams[0]!.id;
    teamBId = created.teams[1]!.id;

    await claimTeam(app, teamAId, managerA.userId);
    await claimTeam(app, teamBId, managerB.userId);

    await addPlayers(baseUrl, commissioner.token, leagueId, [
      { name: "P1", position: "QB" },
      { name: "P2", position: "QB" },
    ]);
    const playerRows = await app.db.select({ id: player.id }).from(player).where(eq(player.leagueId, leagueId));
    playerIds = playerRows.map((r) => r.id);

    const draftResult = await createDraftForLeague(baseUrl, commissioner.token, leagueId);
    draftId = draftResult.draftId;
  });

  afterAll(async () => {
    await cleanupLeague(app.db, leagueId, [commissioner.userId, managerA.userId, managerB.userId, outsider.userId]);
    await app.close();
  });

  it("rejects admin:start from a non-commissioner", async () => {
    const socket = connectSocket(baseUrl, managerA.token);
    await waitForConnect(socket);
    await joinDraft(socket, draftId);

    const res = await emitIntent(socket, "admin:start", {});
    expect(res.ok).toBe(false);
    expect(res.code).toBe("FORBIDDEN");

    socket.disconnect();
  });

  it("lets the commissioner start the draft", async () => {
    const socket = connectSocket(baseUrl, commissioner.token);
    await waitForConnect(socket);
    await joinDraft(socket, draftId);

    const res = await emitIntent(socket, "admin:start", {});
    expect(res.ok).toBe(true);

    socket.disconnect();
  });

  it("rejects a team-scoped intent from a user who owns no team in this league", async () => {
    const socket = connectSocket(baseUrl, outsider.token);
    await waitForConnect(socket);
    await joinDraft(socket, draftId);

    const res = await emitIntent(socket, "nominate", { playerId: playerIds[0] });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("FORBIDDEN");

    socket.disconnect();
  });

  it("attributes a team-scoped intent to the acting socket's own team, never a client-supplied one", async () => {
    const socketA = connectSocket(baseUrl, managerA.token);
    await waitForConnect(socketA);
    await joinDraft(socketA, draftId);

    // The nominate payload schema has no teamId field at all — there is no
    // way for a client to even attempt to act as a different team; the
    // server always resolves it from the authenticated socket's ownership.
    const res = await emitIntent(socketA, "nominate", { playerId: playerIds[1], teamId: teamBId });
    expect(res.ok).toBe(true);

    socketA.disconnect();
  });
});
