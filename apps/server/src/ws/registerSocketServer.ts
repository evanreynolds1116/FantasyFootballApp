import type { Server as HttpServer } from "node:http";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import type { Db } from "../db/client.js";
import type { EngineRuntime } from "../engine/engineRuntime.js";
import { draft } from "../db/schema.js";
import { toPublicSnapshot } from "../shared/publicSnapshot.js";
import { createAuthMiddleware } from "./authMiddleware.js";
import { registerIntentHandlers } from "./intentHandlers.js";
import { roomForDraft } from "./broadcastEvents.js";
import type { SocketData } from "./types.js";

async function getLeagueIdForDraft(db: Db, draftId: string): Promise<string | null> {
  const [row] = await db.select({ leagueId: draft.leagueId }).from(draft).where(eq(draft.id, draftId)).limit(1);
  return row?.leagueId ?? null;
}

export function registerSocketServer(httpServer: HttpServer, db: Db, runtime: EngineRuntime): Server {
  const io = new Server(httpServer, { cors: { origin: true } });
  io.use(createAuthMiddleware(db));

  io.on("connection", (socket) => {
    registerIntentHandlers(runtime, socket);

    socket.on("join", async (payload: { draftId?: string }, ack?: (r: { ok: boolean; error?: string }) => void) => {
      const draftId = payload?.draftId;
      if (!draftId) {
        ack?.({ ok: false, error: "MISSING_DRAFT_ID" });
        return;
      }
      const leagueId = await getLeagueIdForDraft(db, draftId);
      if (!leagueId) {
        ack?.({ ok: false, error: "NOT_FOUND" });
        return;
      }
      (socket.data as SocketData).draftId = draftId;
      (socket.data as SocketData).leagueId = leagueId;
      await socket.join(roomForDraft(draftId));

      const state = await runtime.getOrHydrate(draftId);
      socket.emit("state:snapshot", toPublicSnapshot(state));
      ack?.({ ok: true });
    });

    socket.on("resync", async (_payload: unknown, ack?: (r: { ok: boolean }) => void) => {
      const draftId = (socket.data as SocketData).draftId;
      if (!draftId) {
        ack?.({ ok: false });
        return;
      }
      const state = await runtime.getOrHydrate(draftId);
      socket.emit("state:snapshot", toPublicSnapshot(state));
      ack?.({ ok: true });
    });
  });

  return io;
}
