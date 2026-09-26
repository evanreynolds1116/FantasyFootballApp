import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/buildServer.js";
import { user } from "../src/db/schema.js";
import { cleanupLeague, createDevSession, createLeague, startTestServer } from "./helpers.js";

describe("dev auth", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it("issues a working token that authenticates a protected route", async () => {
    const { token, userId } = await createDevSession(baseUrl, "Alice");
    expect(token).toBeTruthy();
    expect(userId).toBeTruthy();

    const { leagueId, teams } = await createLeague(baseUrl, token, { name: "Auth Test League", teams: [{ name: "T1" }, { name: "T2" }] });
    expect(teams).toHaveLength(2);

    await cleanupLeague(app.db, leagueId, [userId]);
  });

  it("rejects a request with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/leagues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", teams: [{ name: "T1" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a request with an invalid token", async () => {
    const res = await fetch(`${baseUrl}/leagues`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer not-a-real-token" },
      body: JSON.stringify({ name: "x", teams: [{ name: "T1" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("reuses the same userId for repeated sessions with the same email", async () => {
    const first = await createDevSession(baseUrl, "Bob", "bob@example.com");
    const second = await createDevSession(baseUrl, "Bob", "bob@example.com");
    expect(second.userId).toBe(first.userId);
    expect(second.token).not.toBe(first.token);

    await app.db.delete(user).where(eq(user.id, first.userId));
  });
});
