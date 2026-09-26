import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/buildServer.js";
import { loadDraftState } from "../src/db/loadDraftState.js";
import { draftSettings, league, player } from "../src/db/schema.js";
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

describe("mid-draft settings, renaming a started league, and the CSV export", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let leagueId: string;
  let draftId: string;
  let commissioner: { token: string; userId: string };
  let managers: { token: string; userId: string }[];
  let outsider: { token: string; userId: string };
  let playerIds: Map<string, string>;

  const req = (method: string, path: string, token: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestServer());
    commissioner = await createDevSession(baseUrl, "Commish");
    managers = [await createDevSession(baseUrl, "Manager A"), await createDevSession(baseUrl, "Manager B"), await createDevSession(baseUrl, "Manager C")];
    outsider = await createDevSession(baseUrl, "Outsider");
    const created = await createLeague(baseUrl, commissioner.token, {
      name: "Export & Settings Test League",
      settings: { auctionSpots: 1, rosterSize: 2, positionGroups: null, bidClockSec: 60, nominationClockSec: 60, revealTopN: 3 },
      teams: [{ name: "Team A" }, { name: "Team B" }, { name: 'Team "C", Inc' }],
    });
    leagueId = created.leagueId;
    for (let i = 0; i < 3; i++) await claimTeam(app, created.teams[i]!.id, managers[i]!.userId);
    await addPlayers(
      baseUrl,
      commissioner.token,
      leagueId,
      ["Alpha QB", "Bravo RB", "Charlie WR", "Delta TE", "Echo WR", "Foxtrot RB"].map((name) => ({ name, position: name.split(" ")[1]! })),
    );
    const rows = await app.db.select({ id: player.id, name: player.name }).from(player).where(eq(player.leagueId, leagueId));
    playerIds = new Map(rows.map((r) => [r.name, r.id]));
    draftId = (await createDraftForLeague(baseUrl, commissioner.token, leagueId)).draftId;
  });

  afterAll(async () => {
    await cleanupLeague(app.db, leagueId, [commissioner.userId, ...managers.map((m) => m.userId), outsider.userId]);
    await app.close();
  });

  it("saves mid-draft clock and reveal changes, runs a lot, and exports only what was revealed", async () => {
    const commish = connectSocket(baseUrl, commissioner.token);
    const sockets = managers.map((m) => connectSocket(baseUrl, m.token));
    await Promise.all([commish, ...sockets].map(waitForConnect));
    try {
      await Promise.all([commish, ...sockets].map((s) => joinDraft(s, draftId)));
      expect(await emitIntent(commish, "admin:start", {})).toEqual({ ok: true });

      // Mid-draft: the only settings SPEC lets change. Both must survive a reload from the database.
      expect(await emitIntent(commish, "admin:setClocks", { bid: 45, pick: 90 })).toEqual({ ok: true });
      expect(await emitIntent(commish, "admin:setRevealTopN", { revealTopN: 1 })).toEqual({ ok: true });
      const [row] = await app.db.select().from(draftSettings).where(eq(draftSettings.leagueId, leagueId));
      expect(row).toMatchObject({ bidClockSec: 45, pickClockSec: 90, nominationClockSec: 60, revealTopN: "1" });
      const reloaded = await loadDraftState(app.db, draftId);
      expect(reloaded.settings).toMatchObject({ bidClockSec: 45, pickClockSec: 90, revealTopN: 1 });

      // Lot 1: A $30 wins, B's $20 stays hidden (winner only), C passes.
      await emitIntent(sockets[0]!, "nominate", { playerId: playerIds.get("Alpha QB")! });
      await emitIntent(sockets[1]!, "nominate", { playerId: playerIds.get("Bravo RB")! });
      await emitIntent(sockets[2]!, "nominate", { playerId: playerIds.get("Charlie WR")! });
      const lot1 = (await loadDraftState(app.db, draftId)).lots.find((l) => l.state === "open")!;
      const awarded = waitForEvent(sockets[0]!, "lot:awarded");
      await emitIntent(sockets[1]!, "bid:submit", { lotId: lot1.id, amount: 20 });
      await emitIntent(sockets[2]!, "bid:pass", { lotId: lot1.id });
      await emitIntent(sockets[0]!, "bid:submit", { lotId: lot1.id, amount: 30 });
      await awarded;

      const res = await req("GET", `/drafts/${draftId}/export.csv`, managers[1]!.token);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/csv");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="export-settings-test-league-results-so-far.csv"');
      const lines = (await res.text()).trimEnd().split("\r\n");
      expect(lines[0]).toBe("pick,stage,team_number,team,player,position,nfl_team,price,note,revealed_runner_up_bids");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe("1,Auction R1,1,Team A,Alpha QB,QB,,30,,");
      expect(lines.join("\n")).not.toContain("20");
    } finally {
      commish.disconnect();
      sockets.forEach((s) => s.disconnect());
    }
  });

  it("lets only league members download, and 404s an unknown draft", async () => {
    expect((await req("GET", `/drafts/${draftId}/export.csv`, commissioner.token)).status).toBe(200);
    expect((await req("GET", `/drafts/${draftId}/export.csv`, outsider.token)).status).toBe(403);
    expect((await req("GET", "/drafts/00000000-0000-0000-0000-000000000000/export.csv", commissioner.token)).status).toBe(404);
    expect((await req("GET", "/drafts/nope/export.csv", commissioner.token)).status).toBe(404);
    expect((await fetch(`${baseUrl}/drafts/${draftId}/export.csv`)).status).toBe(401);
  });

  it("renames a started league, but keeps its settings locked", async () => {
    expect((await req("PATCH", `/leagues/${leagueId}`, commissioner.token, { name: "Renamed Export League" })).status).toBe(200);
    const [row] = await app.db.select({ name: league.name }).from(league).where(eq(league.id, leagueId));
    expect(row!.name).toBe("Renamed Export League");
    const locked = await req("PATCH", `/leagues/${leagueId}`, commissioner.token, { name: "X", settings: { minBid: 1 } });
    expect(locked.status).toBe(409);
    expect((await req("PATCH", `/leagues/${leagueId}`, managers[0]!.token, { name: "Hijacked" })).status).toBe(403);
    // The export's file name follows the new name.
    const res = await req("GET", `/drafts/${draftId}/export.csv`, commissioner.token);
    expect(res.headers.get("content-disposition")).toContain("renamed-export-league");
  });
});
