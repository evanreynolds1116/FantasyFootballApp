import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { buildServer } from "../src/buildServer.js";
import { user } from "../src/db/schema.js";
import { cleanupLeague, createDevSession, startTestServer } from "./helpers.js";

type Session = { token: string; userId: string };
type LeagueView = {
  name: string;
  isCommissioner: boolean;
  inviteCode: string;
  settings: { teamCount: number; rosterSize: number };
  teams: { id: string; name: string; draftNumber: number; claimed: boolean; managerName: string | null; isMine: boolean }[];
  playerCount: number;
  draft: { id: string; phase: string } | null;
};

describe("league setup and lobby (FR-01..FR-04, Flow 1)", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let commish: Session;
  let alice: Session;
  let bob: Session;
  let outsider: Session;
  const leagueIds: string[] = [];

  const call = async (method: string, path: string, who: Session | null, body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(who ? { authorization: `Bearer ${who.token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
  };

  const createLeague = async (settings: Record<string, unknown> = {}) => {
    const res = await call("POST", "/leagues", commish, {
      name: "Setup Test League",
      settings: { teamCount: 3, rosterSize: 2, auctionSpots: 1, positionGroups: null, revealTopN: 2, ...settings },
    });
    expect(res.status).toBe(200);
    leagueIds.push(res.body.leagueId);
    return res.body.leagueId as string;
  };
  const view = async (leagueId: string, who: Session = commish) => (await call("GET", `/leagues/${leagueId}`, who)).body as LeagueView;
  const players = (n: number, prefix = "P") => Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i + 1}`, position: i % 2 ? "rb" : "QB", mflId: `${prefix}-${i + 1}` }));

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestServer());
    commish = await createDevSession(baseUrl, "Commish");
    alice = await createDevSession(baseUrl, "Alice");
    bob = await createDevSession(baseUrl, "Bob");
    outsider = await createDevSession(baseUrl, "Outsider");
  });

  afterAll(async () => {
    for (const id of leagueIds) await cleanupLeague(app.db, id, []);
    await app.db.delete(user).where(inArray(user.id, [commish.userId, alice.userId, bob.userId, outsider.userId]));
    await app.close();
  });

  it("creates one placeholder slot per team, an invite code, and validates settings against SPEC", async () => {
    const leagueId = await createLeague();
    const league = await view(leagueId);
    expect(league.isCommissioner).toBe(true);
    expect(league.inviteCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(league.teams.map((t) => [t.draftNumber, t.name, t.claimed])).toEqual([
      [1, "Team 1", false],
      [2, "Team 2", false],
      [3, "Team 3", false],
    ]);

    const bad = await call("POST", "/leagues", commish, { name: "Bad", settings: { teamCount: 1, bidClockSec: 5 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("INVALID_SETTINGS");
    expect(bad.body.issues).toHaveLength(2);
  });

  it("lets managers preview an invite and claim one slot each, atomically", async () => {
    const leagueId = await createLeague();
    const { inviteCode, teams } = await view(leagueId);

    expect((await call("GET", `/leagues/${leagueId}`, outsider)).status).toBe(403);
    const preview = await call("GET", `/invites/${inviteCode.toLowerCase()}`, alice);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ leagueId, leagueName: "Setup Test League", commissionerName: "Commish", started: false, myTeamId: null });

    expect((await call("POST", `/invites/${inviteCode}/claim`, alice, { teamId: teams[1]!.id, name: "Alice's Aces" })).status).toBe(200);
    const again = await call("POST", `/invites/${inviteCode}/claim`, alice, { teamId: teams[2]!.id });
    expect(again.body.error).toBe("ALREADY_HAVE_TEAM");
    const taken = await call("POST", `/invites/${inviteCode}/claim`, bob, { teamId: teams[1]!.id, name: "Bob's" });
    expect(taken.body.error).toBe("TEAM_TAKEN");

    const asAlice = await view(leagueId, alice);
    expect(asAlice.isCommissioner).toBe(false);
    expect(asAlice.teams[1]).toMatchObject({ name: "Alice's Aces", claimed: true, managerName: "Alice", isMine: true });
    expect(asAlice.teams[0]).toMatchObject({ claimed: false, isMine: false });

    // Two racing claims for the same slot: exactly one wins.
    const [r1, r2] = await Promise.all([
      call("POST", `/invites/${inviteCode}/claim`, bob, { teamId: teams[2]!.id }),
      call("POST", `/invites/${inviteCode}/claim`, commish, { teamId: teams[2]!.id }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });

  it("regenerating the invite code kills the old link", async () => {
    const leagueId = await createLeague();
    const { inviteCode } = await view(leagueId);
    expect((await call("POST", `/leagues/${leagueId}/invites`, alice)).status).toBe(403);
    const fresh = await call("POST", `/leagues/${leagueId}/invites`, commish);
    expect(fresh.body.inviteCode).not.toBe(inviteCode);
    expect((await call("GET", `/invites/${inviteCode}`, alice)).status).toBe(404);
    expect((await call("GET", `/invites/${fresh.body.inviteCode}`, alice)).status).toBe(200);
  });

  it("edits settings, growing and shrinking slots but never evicting a manager", async () => {
    const leagueId = await createLeague();
    const { inviteCode, teams } = await view(leagueId);
    await call("POST", `/invites/${inviteCode}/claim`, alice, { teamId: teams[2]!.id, name: "Alice's Aces" });

    expect((await call("PATCH", `/leagues/${leagueId}`, alice, { settings: { teamCount: 4 } })).status).toBe(403);
    const invalid = await call("PATCH", `/leagues/${leagueId}`, commish, { settings: { rosterSize: 99 } });
    expect(invalid.body.error).toBe("INVALID_SETTINGS");

    expect((await call("PATCH", `/leagues/${leagueId}`, commish, { name: "Renamed", settings: { teamCount: 5 } })).status).toBe(200);
    let league = await view(leagueId);
    expect(league.name).toBe("Renamed");
    expect(league.teams.map((t) => t.draftNumber)).toEqual([1, 2, 3, 4, 5]);

    // Shrinking removes unclaimed slots from the end; Alice's team survives and is renumbered.
    expect((await call("PATCH", `/leagues/${leagueId}`, commish, { settings: { teamCount: 2 } })).status).toBe(200);
    league = await view(leagueId);
    expect(league.teams.map((t) => [t.draftNumber, t.name])).toEqual([
      [1, "Team 1"],
      [2, "Alice's Aces"],
    ]);

    // With 3 of 3 slots claimed, shrinking to 2 would evict someone: refused, nothing changes.
    await call("POST", `/invites/${inviteCode}/claim`, bob, { teamId: league.teams[0]!.id });
    await call("PATCH", `/leagues/${leagueId}`, commish, { settings: { teamCount: 3 } });
    league = await view(leagueId);
    await call("POST", `/invites/${inviteCode}/claim`, commish, { teamId: league.teams[2]!.id });
    const cantShrink = await call("PATCH", `/leagues/${leagueId}`, commish, { settings: { teamCount: 2, rosterSize: 3 } });
    expect(cantShrink.body.error).toBe("TEAMS_CLAIMED");
    league = await view(leagueId);
    expect(league.teams).toHaveLength(3);
    expect(league.settings.rosterSize).toBe(2);
  });

  it("renames, releases, and orders teams with the right permissions", async () => {
    const leagueId = await createLeague();
    const { inviteCode, teams } = await view(leagueId);
    await call("POST", `/invites/${inviteCode}/claim`, alice, { teamId: teams[0]!.id });
    await call("POST", `/invites/${inviteCode}/claim`, bob, { teamId: teams[1]!.id });

    expect((await call("PATCH", `/leagues/${leagueId}/teams/${teams[0]!.id}`, alice, { name: "Mine Now" })).status).toBe(200);
    expect((await call("PATCH", `/leagues/${leagueId}/teams/${teams[0]!.id}`, bob, { name: "Stolen" })).status).toBe(403);
    expect((await call("PATCH", `/leagues/${leagueId}/teams/${teams[1]!.id}`, commish, { name: "Tidied" })).status).toBe(200);

    expect((await call("DELETE", `/leagues/${leagueId}/teams/${teams[1]!.id}/manager`, alice)).status).toBe(403);
    expect((await call("DELETE", `/leagues/${leagueId}/teams/${teams[1]!.id}/manager`, commish)).status).toBe(200);
    let league = await view(leagueId);
    expect(league.teams[1]).toMatchObject({ name: "Team 2", claimed: false });

    const notPermutation = await call("PUT", `/leagues/${leagueId}/draft-order`, commish, {
      order: [
        { teamId: teams[0]!.id, draftNumber: 1 },
        { teamId: teams[1]!.id, draftNumber: 1 },
        { teamId: teams[2]!.id, draftNumber: 3 },
      ],
    });
    expect(notPermutation.body.error).toBe("INVALID_ORDER");
    const reversed = teams.map((t, i) => ({ teamId: t.id, draftNumber: 3 - i }));
    expect((await call("PUT", `/leagues/${leagueId}/draft-order`, commish, { order: reversed })).status).toBe(200);
    league = await view(leagueId);
    expect(league.teams.map((t) => t.id)).toEqual([teams[2]!.id, teams[1]!.id, teams[0]!.id]);

    expect((await call("POST", `/leagues/${leagueId}/draft-order/shuffle`, alice)).status).toBe(403);
    expect((await call("POST", `/leagues/${leagueId}/draft-order/shuffle`, commish)).status).toBe(200);
    league = await view(leagueId);
    expect(league.teams.map((t) => t.draftNumber)).toEqual([1, 2, 3]);
    expect(new Set(league.teams.map((t) => t.id))).toEqual(new Set(teams.map((t) => t.id)));
  });

  it("manages the player pool: add, skip duplicate MFL ids, replace, remove", async () => {
    const leagueId = await createLeague();
    expect((await call("POST", `/leagues/${leagueId}/players`, alice, { players: players(2) })).status).toBe(403);

    const first = await call("POST", `/leagues/${leagueId}/players`, commish, { players: players(4) });
    expect(first.body).toMatchObject({ added: 4, skipped: 0 });
    const dupes = await call("POST", `/leagues/${leagueId}/players`, commish, { players: [...players(2), { name: "New Guy", position: "wr" }] });
    expect(dupes.body).toMatchObject({ added: 1, skipped: 2 });

    let list = (await call("GET", `/leagues/${leagueId}/players`, commish)).body.players as { id: string; name: string; position: string }[];
    expect(list).toHaveLength(5);
    expect(list.find((p) => p.name === "New Guy")?.position).toBe("WR");
    expect(list.find((p) => p.name === "P2")?.position).toBe("RB");

    expect((await call("DELETE", `/leagues/${leagueId}/players/${list[0]!.id}`, commish)).status).toBe(200);
    const replaced = await call("POST", `/leagues/${leagueId}/players`, commish, { players: players(3, "R"), replace: true });
    expect(replaced.body).toMatchObject({ added: 3 });
    list = (await call("GET", `/leagues/${leagueId}/players`, commish)).body.players;
    expect(list.map((p) => p.name).sort()).toEqual(["R1", "R2", "R3"]);

    // Photos: https links are stored and listed; anything else is refused (they're shown as images everywhere).
    const photo = "https://sleepercdn.com/content/nfl/players/4034.jpg";
    expect((await call("POST", `/leagues/${leagueId}/players`, commish, { players: [{ name: "Pic Guy", position: "RB", photoUrl: photo }] })).status).toBe(201);
    const withPhoto = ((await call("GET", `/leagues/${leagueId}/players`, commish)).body.players as { name: string; photoUrl: string | null }[]).find((p) => p.name === "Pic Guy");
    expect(withPhoto?.photoUrl).toBe(photo);
    for (const bad of ["http://example.com/x.jpg", "javascript:alert(1)", "not a url"]) {
      expect((await call("POST", `/leagues/${leagueId}/players`, commish, { players: [{ name: "Bad Pic", position: "RB", photoUrl: bad }] })).status).toBe(400);
    }
  });

  it("starts the draft only with a big enough pool, then locks setup", async () => {
    const leagueId = await createLeague();
    const { inviteCode, teams } = await view(leagueId);
    await call("POST", `/invites/${inviteCode}/claim`, alice, { teamId: teams[0]!.id });

    await call("POST", `/leagues/${leagueId}/players`, commish, { players: players(5) });
    expect((await call("POST", `/leagues/${leagueId}/start`, alice)).status).toBe(403);
    const tooSmall = await call("POST", `/leagues/${leagueId}/start`, commish);
    expect(tooSmall.body.error).toBe("POOL_TOO_SMALL"); // 3 teams x 2 spots = 6

    await call("POST", `/leagues/${leagueId}/players`, commish, { players: players(1, "X") });
    // Unclaimed slots are allowed (the lobby warns); concurrent Start taps create one draft.
    const [s1, s2] = await Promise.all([call("POST", `/leagues/${leagueId}/start`, commish), call("POST", `/leagues/${leagueId}/start`, commish)]);
    const ok = [s1, s2].filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    expect([s1, s2].find((r) => r.status !== 200)!.body.error).toBe("ALREADY_STARTED");
    const draftId = ok[0]!.body.draftId as string;

    const league = await view(leagueId, alice);
    expect(league.draft).toEqual({ id: draftId, phase: "auction" });
    const state = (await call("GET", `/drafts/${draftId}/state`, alice)).body;
    expect(state.phase).toBe("auction");
    expect(state.teams).toHaveLength(3);
    expect(state.players).toHaveLength(6);

    for (const [method, path, body] of [
      ["PATCH", `/leagues/${leagueId}`, { settings: { teamCount: 4 } }],
      ["POST", `/leagues/${leagueId}/players`, { players: players(1, "Late") }],
      ["PATCH", `/leagues/${leagueId}/teams/${teams[0]!.id}`, { name: "Too late" }],
      ["POST", `/leagues/${leagueId}/draft-order/shuffle`, undefined],
      ["POST", `/invites/${inviteCode}/claim`, { teamId: teams[1]!.id }],
    ] as const) {
      const res = await call(method, path, method === "POST" && path.startsWith("/invites") ? bob : commish, body);
      expect(res.body.error, `${method} ${path}`).toBe("LOCKED");
    }

    const mine = (await call("GET", "/leagues", alice)).body.leagues as { id: string; myTeamName: string; isCommissioner: boolean; draft: unknown }[];
    expect(mine.find((l) => l.id === leagueId)).toMatchObject({ myTeamName: "Team 1", isCommissioner: false, draft: { id: draftId, phase: "auction" } });
    expect((await call("GET", "/leagues", outsider)).body.leagues.find((l: { id: string }) => l.id === leagueId)).toBeUndefined();
  });
});
