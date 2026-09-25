import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveToken } from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

/** Fastify preHandler: resolves `Authorization: Bearer <token>` to request.userId, 401s otherwise. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    await reply.code(401).send({ error: "UNAUTHENTICATED", message: "Missing bearer token." });
    return;
  }
  const userId = await resolveToken(request.server.db, token);
  if (!userId) {
    await reply.code(401).send({ error: "UNAUTHENTICATED", message: "Invalid or expired token." });
    return;
  }
  request.userId = userId;
}
