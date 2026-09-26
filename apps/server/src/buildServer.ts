import Fastify, { type FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import { createDb, type Db } from "./db/client.js";
import { createEngineRuntime, type EngineRuntime } from "./engine/engineRuntime.js";
import { registerDevRoutes } from "./http/routes/dev.js";
import { registerDraftRoutes } from "./http/routes/drafts.js";
import { registerInviteRoutes } from "./http/routes/invites.js";
import { registerLeagueRoutes } from "./http/routes/leagues.js";
import { registerPlayerRoutes } from "./http/routes/players.js";
import "./http/types.js";
import { broadcastEvents } from "./ws/broadcastEvents.js";
import { registerSocketServer } from "./ws/registerSocketServer.js";

declare module "fastify" {
  interface FastifyInstance {
    io: Server;
    engineRuntime: EngineRuntime;
  }
}

export type BuildServerOptions = {
  /** Injectable for tests; defaults to a fresh connection built from DATABASE_URL. */
  db?: Db;
  /** Defaults to true; tests typically pass false to keep output readable. */
  logger?: boolean;
};

/**
 * Builds (but does not start listening) a Fastify instance with Socket.IO
 * attached. Exported as a factory rather than a side-effecting module-scope
 * app, so tests can build, listen, close, and rebuild a fresh instance to
 * exercise the restart-recovery path against the same Postgres rows.
 *
 * Every instance gets its own EngineRuntime (in-memory draft registry, timer
 * scheduler, applyAction mutex) — never a module-level singleton — so two
 * independent instances (e.g. simulating a restart within one test process)
 * never see each other's in-memory state.
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true });

  let db: Db;
  let ownsClient: { end: () => Promise<void> } | null = null;
  if (options.db) {
    db = options.db;
  } else {
    const created = createDb();
    db = created.db;
    ownsClient = created.client;
  }
  app.decorate("db", db);

  const runtime = createEngineRuntime(db);
  app.decorate("engineRuntime", runtime);

  const io = registerSocketServer(app.server, db, runtime);
  app.decorate("io", io);
  // Wired here, not in createEngineRuntime: io can only be built from the
  // runtime (intent handlers need it), so this is the earliest point both
  // exist. Without this, clock-driven actions (fireExpiry) would persist
  // correctly but never reach connected clients.
  runtime.setBroadcaster((draftId, state, events) => broadcastEvents(io, draftId, state, events));

  await app.register(registerDevRoutes);
  await app.register(registerLeagueRoutes);
  await app.register(registerPlayerRoutes);
  await app.register(registerInviteRoutes);
  await app.register(registerDraftRoutes);

  app.addHook("onClose", async () => {
    io.close();
    if (ownsClient) await ownsClient.end();
  });

  return app;
}
