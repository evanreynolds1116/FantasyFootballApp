import { eq, and } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { user } from "../../db/schema.js";
import { createSession } from "../sessions.js";

const sessionBody = z.object({
  displayName: z.string().min(1),
  email: z.string().email().optional(),
});

/**
 * Dev-only auth: POST /dev/session { displayName, email? } -> { token, userId },
 * no check at all. Registered only when DEV_LOGIN=true (see buildServer) —
 * real sign-in is the email code/link in auth.ts.
 */
export async function registerDevRoutes(app: FastifyInstance): Promise<void> {
  app.post("/dev/session", async (request, reply) => {
    const parsed = sessionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", message: parsed.error.message });
    }
    const { displayName, email } = parsed.data;

    let userId: string;
    if (email) {
      const [existing] = await request.server.db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.email, email), eq(user.authProvider, "dev")))
        .limit(1);
      if (existing) {
        userId = existing.id;
      } else {
        const [created] = await request.server.db.insert(user).values({ displayName, email, authProvider: "dev" }).returning({ id: user.id });
        userId = created!.id;
      }
    } else {
      const [created] = await request.server.db.insert(user).values({ displayName, authProvider: "dev" }).returning({ id: user.id });
      userId = created!.id;
    }

    const token = await createSession(request.server.db, userId);
    return reply.send({ token, userId });
  });
}
