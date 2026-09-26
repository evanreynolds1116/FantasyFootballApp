import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/buildServer.js";
import { loginCode, session, user } from "../src/db/schema.js";
import { MAX_CODE_ATTEMPTS, MAX_CODES_PER_WINDOW } from "../src/http/routes/auth.js";
import { SESSION_TTL_MS } from "../src/http/sessions.js";
import {
  cleanupLeague,
  connectSocket,
  createDevSession,
  createDraftForLeague,
  createLeague,
  emitIntent,
  joinDraft,
  startTestServer,
  waitForConnect,
  type SentMail,
} from "./helpers.js";

const run = Date.now().toString(36);
const addr = (name: string) => `${name}-${run}@auth-test.example`;

async function post(baseUrl: string, path: string, body: unknown, token?: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function get(baseUrl: string, path: string, token: string) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The code and link token from the newest email to `to`. */
function lastMail(sent: SentMail[], to: string) {
  const mail = [...sent].reverse().find((m) => m.to === to)!;
  return { code: /code is (\d{6})/.exec(mail.text)![1]!, token: /\/login\/verify\?t=([\w-]+)/.exec(mail.text)![1]!, mail };
}

describe("email sign-in: code and link", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let sentMail: SentMail[];
  const emails: string[] = [];
  const email = (name: string) => {
    const e = addr(name);
    emails.push(e);
    return e;
  };

  beforeAll(async () => {
    ({ app, baseUrl, sentMail } = await startTestServer());
  });

  afterAll(async () => {
    await app.db.delete(loginCode).where(inArray(loginCode.email, emails));
    await app.db.delete(user).where(inArray(sql`lower(${user.email})`, emails));
    await app.close();
  });

  it("emails a code and a link; the code signs in a new account, which then sets its name", async () => {
    const e = email("newbie");
    expect((await post(baseUrl, "/auth/start", { email: `  ${e.toUpperCase()} `, next: "/join/ABC" })).body).toEqual({ ok: true });
    const { code, mail } = lastMail(sentMail, e);
    expect(mail.subject).toContain(code);
    expect(mail.text).toContain("http://app.test/login/verify?t=");

    const verified = await post(baseUrl, "/auth/verify", { email: e, code });
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ next: "/join/ABC", needsName: true });
    const token = verified.body.token as string;
    expect((await get(baseUrl, "/me", token)).body).toMatchObject({ email: e, displayName: `newbie-${run}` });

    expect((await fetch(`${baseUrl}/me`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Casey" }) })).status).toBe(200);
    expect((await get(baseUrl, "/me", token)).body).toMatchObject({ displayName: "Casey" });

    // Signing in again finds the same account.
    await post(baseUrl, "/auth/start", { email: e });
    const again = await post(baseUrl, "/auth/verify", { email: e, code: lastMail(sentMail, e).code });
    expect(again.body).toMatchObject({ userId: verified.body.userId, needsName: false, next: null });
  });

  it("the link works once, and using it retires the code from the same email", async () => {
    const e = email("linker");
    await post(baseUrl, "/auth/start", { email: e });
    const { code, token } = lastMail(sentMail, e);
    expect((await post(baseUrl, "/auth/verify", { token })).status).toBe(200);
    expect((await post(baseUrl, "/auth/verify", { token })).body).toMatchObject({ error: "LINK_EXPIRED" });
    expect((await post(baseUrl, "/auth/verify", { email: e, code })).body).toMatchObject({ error: "CODE_EXPIRED" });
  });

  it(`locks a code after ${MAX_CODE_ATTEMPTS} wrong tries, and a code only works for its own address`, async () => {
    const e = email("guesser");
    await post(baseUrl, "/auth/start", { email: e });
    const { code } = lastMail(sentMail, e);
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await post(baseUrl, "/auth/verify", { email: email("someone-else"), code })).body).toMatchObject({ error: "CODE_EXPIRED" });
    const first = await post(baseUrl, "/auth/verify", { email: e, code: wrong });
    expect(first.body).toMatchObject({ error: "WRONG_CODE", message: `That code isn't right. ${MAX_CODE_ATTEMPTS - 1} tries left.` });
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) await post(baseUrl, "/auth/verify", { email: e, code: wrong });
    expect((await post(baseUrl, "/auth/verify", { email: e, code })).body).toMatchObject({ error: "CODE_EXPIRED" });
  });

  it("refuses an expired code", async () => {
    const e = email("late");
    await post(baseUrl, "/auth/start", { email: e });
    const { code } = lastMail(sentMail, e);
    await app.db.update(loginCode).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(loginCode.email, e));
    expect((await post(baseUrl, "/auth/verify", { email: e, code })).body).toMatchObject({ error: "CODE_EXPIRED" });
  });

  it(`sends at most ${MAX_CODES_PER_WINDOW} emails per address per 15 minutes`, async () => {
    const e = email("spammed");
    for (let i = 0; i < MAX_CODES_PER_WINDOW; i++) expect((await post(baseUrl, "/auth/start", { email: e })).status).toBe(200);
    expect((await post(baseUrl, "/auth/start", { email: e })).status).toBe(429);
  });

  it("rejects a bad email address", async () => {
    expect((await post(baseUrl, "/auth/start", { email: "not-an-email" })).body).toMatchObject({ error: "INVALID_EMAIL" });
  });

  it("takes over a dev-login account with the same email, so existing teams carry over", async () => {
    const e = email("carryover");
    const dev = await createDevSession(baseUrl, "Old Dev Name", e.toUpperCase());
    await post(baseUrl, "/auth/start", { email: e });
    const verified = await post(baseUrl, "/auth/verify", { email: e, code: lastMail(sentMail, e).code });
    expect(verified.body).toMatchObject({ userId: dev.userId, needsName: false });
  });

  it("sessions last 90 days, and signing out ends one", async () => {
    const e = email("leaver");
    await post(baseUrl, "/auth/start", { email: e });
    const token = (await post(baseUrl, "/auth/verify", { email: e, code: lastMail(sentMail, e).code })).body.token as string;
    const [row] = await app.db.select().from(session).where(eq(session.token, token));
    expect(Math.abs(row!.expiresAt!.getTime() - (Date.now() + SESSION_TTL_MS))).toBeLessThan(60_000);
    expect((await post(baseUrl, "/auth/logout", {}, token)).status).toBe(200);
    expect((await get(baseUrl, "/me", token)).status).toBe(401);
  });

  it("reports whether the dev login is on", async () => {
    const res = await fetch(`${baseUrl}/auth/config`);
    expect(await res.json()).toEqual({ devLogin: true });
  });
});

describe("big-board (spectator) link", () => {
  it("watches a draft without signing in, and can do nothing else", async () => {
    const { app, baseUrl } = await startTestServer({ devLogin: true });
    const commish = await createDevSession(baseUrl, "Board Commish");
    const { leagueId } = await createLeague(baseUrl, commish.token, { name: "Spectator Test League", teams: [{ name: "A" }, { name: "B" }] });
    try {
      const { draftId } = await createDraftForLeague(baseUrl, commish.token, leagueId);
      expect((await post(baseUrl, "/drafts/00000000-0000-0000-0000-000000000000/spectate", {})).status).toBe(404);
      expect((await post(baseUrl, "/drafts/not-a-uuid/spectate", {})).status).toBe(404);
      const { body } = await post(baseUrl, `/drafts/${draftId}/spectate`, {});
      const token = body.token as string;
      expect(token.startsWith("spec_")).toBe(true);

      expect((await get(baseUrl, "/me", token)).status).toBe(403);
      expect((await get(baseUrl, "/leagues", token)).status).toBe(403);

      const socket = connectSocket(baseUrl, token);
      await waitForConnect(socket);
      try {
        const snapshot = new Promise<{ myTeamId: string | null; isCommissioner: boolean }>((r) => socket.once("state:snapshot", r));
        await joinDraft(socket, draftId);
        expect(await snapshot).toMatchObject({ myTeamId: null, isCommissioner: false });
        expect(await emitIntent(socket, "admin:start", {})).toMatchObject({ ok: false, code: "FORBIDDEN" });
      } finally {
        socket.disconnect();
      }
    } finally {
      await cleanupLeague(app.db, leagueId, [commish.userId]);
      await app.close();
    }
  });
});

describe("dev login is off unless asked for", () => {
  it("has no /dev/session route without devLogin", async () => {
    const { app, baseUrl } = await startTestServer({ devLogin: false });
    try {
      const res = await fetch(`${baseUrl}/dev/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "x" }) });
      expect(res.status).toBe(404);
      expect(await (await fetch(`${baseUrl}/auth/config`)).json()).toEqual({ devLogin: false });
    } finally {
      await app.close();
    }
  });
});
