import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { draft, loginCode, session, user } from "../../db/schema.js";
import type { Mailer } from "../../mail/mailer.js";
import { requireAuth } from "../auth.js";
import { createSession } from "../sessions.js";

/** How long a sign-in email's code and link work. */
export const LOGIN_CODE_TTL_MS = 15 * 60_000;
/** Wrong guesses allowed on one code before it stops working. */
export const MAX_CODE_ATTEMPTS = 5;
/** Sign-in emails allowed per address per LOGIN_CODE_TTL_MS. */
export const MAX_CODES_PER_WINDOW = 5;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const codeHash = (email: string, code: string) => sha256(`${email}:${code}`);
const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Only same-app paths, never an absolute URL someone put in ?next=. */
function safeNext(next: string | undefined | null): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next.slice(0, 500) : null;
}

const startBody = z.object({ email: z.string().trim().email().max(254), next: z.string().optional() });
const verifyBody = z.union([
  z.object({ email: z.string().trim().email(), code: z.string().trim().regex(/^\d{6}$/) }),
  z.object({ token: z.string().min(20).max(100) }),
]);
const profileBody = z.object({ displayName: z.string().trim().min(1).max(40) });

export type AuthRouteOptions = { mailer: Mailer; appUrl: string; devLogin: boolean };

/**
 * Magic-link / code sign-in (SPEC FR-02: "no password beyond a magic link or
 * code"). POST /auth/start emails a 6-digit code and a link; POST
 * /auth/verify trades either for a session. The account is the email
 * address: the first sign-in creates it (or takes over a dev-login account
 * with that email, so existing test teams carry over).
 */
export async function registerAuthRoutes(app: FastifyInstance, opts: AuthRouteOptions): Promise<void> {
  const db = app.db;

  app.get("/auth/config", async () => ({ devLogin: opts.devLogin }));

  app.post("/auth/start", async (request, reply) => {
    const parsed = startBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_EMAIL", message: "Enter a valid email address." });
    const email = normalizeEmail(parsed.data.email);

    const since = new Date(Date.now() - LOGIN_CODE_TTL_MS);
    const [{ recent } = { recent: 0 }] = await db
      .select({ recent: sql<number>`count(*)::int` })
      .from(loginCode)
      .where(and(eq(loginCode.email, email), gt(loginCode.createdAt, since)));
    if (recent >= MAX_CODES_PER_WINDOW) {
      return reply.code(429).send({ error: "TOO_MANY", message: "Too many sign-in emails. Wait a few minutes and try again." });
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const link = randomBytes(32).toString("base64url");
    await db.insert(loginCode).values({
      email,
      codeHash: codeHash(email, code),
      linkHash: sha256(link),
      next: safeNext(parsed.data.next),
      expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS),
    });

    const url = `${opts.appUrl.replace(/\/$/, "")}/login/verify?t=${link}`;
    try {
      await opts.mailer.send({
        to: email,
        subject: `Your Draft Day sign-in code: ${code}`,
        text: [
          `Your Draft Day sign-in code is ${code}`,
          "",
          "Type it into the app, or open this link on the device you want to sign in on:",
          url,
          "",
          "Both work once and expire in 15 minutes. If you didn't ask to sign in, you can ignore this email.",
        ].join("\n"),
      });
    } catch (err) {
      request.log.error({ err }, "sign-in email failed");
      return reply.code(502).send({ error: "MAIL_FAILED", message: "We couldn't send the email. Try again in a minute." });
    }
    return reply.send({ ok: true });
  });

  app.post("/auth/verify", async (request, reply) => {
    const parsed = verifyBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_CODE", message: "Enter the 6-digit code from the email." });
    const now = new Date();
    const live = and(isNull(loginCode.usedAt), gt(loginCode.expiresAt, now));

    let row: typeof loginCode.$inferSelect | undefined;
    if ("token" in parsed.data) {
      [row] = await db.select().from(loginCode).where(and(eq(loginCode.linkHash, sha256(parsed.data.token)), live)).limit(1);
      if (!row) return reply.code(400).send({ error: "LINK_EXPIRED", message: "This sign-in link has expired or was already used. Ask for a new one." });
    } else {
      const email = normalizeEmail(parsed.data.email);
      // The newest live code for the address is the one being typed.
      const [latest] = await db.select().from(loginCode).where(and(eq(loginCode.email, email), live)).orderBy(sql`${loginCode.createdAt} desc`).limit(1);
      if (!latest || latest.attempts >= MAX_CODE_ATTEMPTS) {
        return reply.code(400).send({ error: "CODE_EXPIRED", message: "That code has expired. Ask for a new one." });
      }
      if (latest.codeHash !== codeHash(email, parsed.data.code)) {
        await db.update(loginCode).set({ attempts: latest.attempts + 1 }).where(eq(loginCode.id, latest.id));
        const left = MAX_CODE_ATTEMPTS - latest.attempts - 1;
        return reply
          .code(400)
          .send({ error: "WRONG_CODE", message: left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Ask for a new code." });
      }
      row = latest;
    }

    // Single use: this code and every other outstanding one for the address.
    const used = await db
      .update(loginCode)
      .set({ usedAt: now })
      .where(and(eq(loginCode.email, row.email), isNull(loginCode.usedAt)))
      .returning({ id: loginCode.id });
    if (!used.some((u) => u.id === row.id)) return reply.code(400).send({ error: "CODE_EXPIRED", message: "That code was already used. Ask for a new one." });

    const [existing] = await db.select().from(user).where(sql`lower(${user.email}) = ${row.email}`).orderBy(asc(user.createdAt)).limit(1);
    let userId: string;
    let needsName = false;
    if (existing) {
      userId = existing.id;
      if (existing.authProvider !== "email") await db.update(user).set({ authProvider: "email" }).where(eq(user.id, existing.id));
    } else {
      const [created] = await db.insert(user).values({ displayName: row.email.split("@")[0]!.slice(0, 40), email: row.email, authProvider: "email" }).returning({ id: user.id });
      userId = created!.id;
      needsName = true;
    }

    const token = await createSession(db, userId);
    return reply.send({ token, userId, next: row.next, needsName });
  });

  /**
   * The big board's way in (SPEC: "no login beyond the league's board
   * link"): a watch-only session for one draft, as that draft's spectator
   * user. Knowing the board link (the draft id) is the permission.
   */
  app.post("/drafts/:draftId/spectate", async (request, reply) => {
    const parsed = z.object({ draftId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ error: "NOT_FOUND", message: "No such draft." });
    const { draftId } = parsed.data;
    const [found] = await db.select({ id: draft.id }).from(draft).where(eq(draft.id, draftId)).limit(1);
    if (!found) return reply.code(404).send({ error: "NOT_FOUND", message: "No such draft." });
    // One spectator user per draft, keyed by a non-address "email" that real sign-in can never match.
    const key = `spectator:${draftId}`;
    const [existing] = await db.select({ id: user.id }).from(user).where(and(eq(user.email, key), eq(user.authProvider, "spectator"))).limit(1);
    const spectatorId =
      existing?.id ?? (await db.insert(user).values({ displayName: "Big board", email: key, authProvider: "spectator" }).returning({ id: user.id }))[0]!.id;
    return { token: await createSession(db, spectatorId, { spectator: true }) };
  });

  app.get("/me", { preHandler: requireAuth }, async (request) => {
    const [me] = await db.select({ id: user.id, displayName: user.displayName, email: user.email }).from(user).where(eq(user.id, request.userId!)).limit(1);
    return { userId: me!.id, displayName: me!.displayName, email: me!.email };
  });

  app.patch("/me", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = profileBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_NAME", message: "Enter a name, up to 40 characters." });
    await db.update(user).set({ displayName: parsed.data.displayName }).where(eq(user.id, request.userId!));
    return { ok: true };
  });

  app.post("/auth/logout", { preHandler: requireAuth }, async (request) => {
    const token = request.headers.authorization!.slice("Bearer ".length);
    await db.delete(session).where(eq(session.token, token));
    return { ok: true };
  });
}
