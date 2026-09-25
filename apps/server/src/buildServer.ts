import Fastify, { type FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import { createDb, type Db } from "./db/client.js";
import { registerDevRoutes } from "./http/routes/dev.js";
import { registerDraftRoutes } from "./http/routes/drafts.js";
import { registerLeagueRoutes } from "./http/routes/leagues.js";
import "./http/types.js";
import { registerSocketServer } from "./ws/registerSocketServer.js";

declare module "fastify" {
  interface FastifyInstance {
    io: Server;
  }
}

export type BuildServerOptions = {
  /** Injectable for tests; defaults to a fresh connection built from DATABASE_URL. */
  db?: Db;
};

/**
 * Builds (but does not start listening) a Fastify instance with Socket.IO
 * attached. Exported as a factory rather than a side-effecting module-scope
 * app, so tests can build, listen, close, and rebuild a fresh instance to
 * exercise the restart-recovery path against the same Postgres rows.
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  const db = options.db ?? createDb().db;
  app.decorate("db", db);

  await app.register(registerDevRoutes);
  await app.register(registerLeagueRoutes);
  await app.register(registerDraftRoutes);

  await app.ready();
  const io = registerSocketServer(app.server, db);
  app.decorate("io", io);

  app.addHook("onClose", async () => {
    io.close();
  });

  return app;
}
