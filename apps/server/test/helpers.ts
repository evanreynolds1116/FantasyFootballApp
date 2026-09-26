import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { io as ioClient, type Socket } from "socket.io-client";
import { buildServer } from "../src/buildServer.js";
import type { Db } from "../src/db/client.js";
import { DEFAULT_SETTINGS, type DraftSettings } from "@draft-app/engine";
import { settingsToRow } from "../src/db/mappers.js";
import { draft, draftSettings, team, user, league } from "../src/db/schema.js";

/** Every sign-in email the test server "sent", newest last. */
export type SentMail = { to: string; subject: string; text: string };

export async function startTestServer(options: { devLogin?: boolean } = {}) {
  const sentMail: SentMail[] = [];
  const app = await buildServer({
    logger: false,
    devLogin: options.devLogin ?? true,
    mailer: { send: async (m) => void sentMail.push(m) },
    appUrl: "http://app.test",
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { app, baseUrl, port, sentMail };
}

export async function createDevSession(baseUrl: string, displayName: string, email?: string) {
  const res = await fetch(`${baseUrl}/dev/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName, email }),
  });
  if (!res.ok) throw new Error(`dev/session failed: ${res.status}`);
  return (await res.json()) as { token: string; userId: string };
}

export async function createLeague(
  baseUrl: string,
  token: string,
  body: { name: string; settings?: Record<string, unknown>; teams: { name: string }[] },
) {
  const res = await fetch(`${baseUrl}/leagues`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /leagues failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { leagueId: string; teams: { id: string; draftNumber: number }[] };
}

export async function addPlayers(baseUrl: string, token: string, leagueId: string, players: { name: string; position: string }[]) {
  const res = await fetch(`${baseUrl}/leagues/${leagueId}/players`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ players }),
  });
  if (!res.ok) throw new Error(`POST /leagues/:id/players failed: ${res.status} ${await res.text()}`);
}

export async function createDraftForLeague(baseUrl: string, token: string, leagueId: string) {
  const res = await fetch(`${baseUrl}/leagues/${leagueId}/drafts`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`POST /leagues/:id/drafts failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { draftId: string };
}

/**
 * Test-only: creates a league straight in the database, skipping POST
 * /leagues' SPEC range validation. For engine-level scenarios that need
 * deliberately out-of-range settings (a 1-team league, a 2-second clock).
 * Mirrors the route's inserts; returns the same shape as createLeague.
 */
export async function createLeagueUnchecked(
  app: Awaited<ReturnType<typeof buildServer>>,
  commissionerUserId: string,
  body: { name: string; settings?: Partial<DraftSettings>; teams: { name: string }[] },
) {
  const settings: DraftSettings = { ...DEFAULT_SETTINGS, ...body.settings, teamCount: body.teams.length };
  const [row] = await app.db.insert(league).values({ name: body.name, commissionerUserId }).returning({ id: league.id });
  const leagueId = row!.id;
  await app.db.insert(draftSettings).values(settingsToRow(leagueId, settings));
  const teams = await app.db
    .insert(team)
    .values(body.teams.map((t, i) => ({ leagueId, name: t.name, draftNumber: i + 1 })))
    .returning({ id: team.id, draftNumber: team.draftNumber });
  return { leagueId, teams: teams.sort((a, b) => a.draftNumber - b.draftNumber) };
}

/** Dev-only test shortcut: directly assigns a team to a user, bypassing the (phase-3) invite/claim flow. */
export async function claimTeam(app: Awaited<ReturnType<typeof buildServer>>, teamId: string, userId: string) {
  await app.db.update(team).set({ userId }).where(eq(team.id, teamId));
}

export function connectSocket(baseUrl: string, token: string): Socket {
  return ioClient(baseUrl, { auth: { token }, transports: ["websocket"], forceNew: true });
}

export function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (err) => reject(err));
  });
}

export function joinDraft(socket: Socket, draftId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.emit("join", { draftId }, (ack: { ok: boolean; error?: string }) => {
      if (ack.ok) resolve(ack);
      else reject(new Error(ack.error));
    });
  });
}

export function emitIntent(socket: Socket, event: string, payload: unknown): Promise<{ ok: boolean; code?: string; message?: string }> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (ack: { ok: boolean; code?: string; message?: string }) => resolve(ack));
  });
}

export function waitForEvent<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}

/**
 * team/lot/bid/pick have FK paths to both `league` (indirectly) and to each
 * other; those cross-references are intentionally NOT cascading (deleting a
 * team shouldn't silently wipe historical bid/pick audit rows in real
 * operation), so tests must delete `draft` (which cleanly cascades
 * lot/bid/pick/audit_event) before `league` (which cascades team/player/
 * draft_settings) — the reverse order trips a FK violation.
 */
export async function cleanupLeague(db: Db, leagueId: string, userIds: string[]) {
  const drafts = await db.select({ id: draft.id }).from(draft).where(eq(draft.leagueId, leagueId));
  for (const d of drafts) await db.delete(user).where(eq(user.email, `spectator:${d.id}`));
  await db.delete(draft).where(eq(draft.leagueId, leagueId));
  await db.delete(league).where(eq(league.id, leagueId));
  for (const userId of userIds) {
    await db.delete(user).where(eq(user.id, userId));
  }
}
