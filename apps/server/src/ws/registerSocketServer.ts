import type { Server as HttpServer } from "node:http";
import { eq } from "drizzle-orm";
import { Server, type Socket } from "socket.io";
import type { Db } from "../db/client.js";
import type { EngineRuntime } from "../engine/engineRuntime.js";
import { draft } from "../db/schema.js";
import { findOwnedTeamId, isCommissioner } from "../http/authz.js";
import { toPublicSnapshot } from "../shared/publicSnapshot.js";
import { createAuthMiddleware } from "./authMiddleware.js";
import { registerIntentHandlers } from "./intentHandlers.js";
import { roomForDraft } from "./broadcastEvents.js";
import { createPresence, type Presence } from "./presence.js";
import type { SocketData } from "./types.js";

async function getLeagueIdForDraft(db: Db, draftId: string): Promise<string | null> {
  const [row] = await db.select({ leagueId: draft.leagueId }).from(draft).where(eq(draft.id, draftId)).limit(1);
  return row?.leagueId ?? null;
}

/**
 * The per-socket snapshot: the public (bid-scrubbed) state plus the fields
 * that differ by viewer — which team is theirs, whether they're the
 * commissioner — and the current presence list, so a fresh join or resync
 * never has to wait for the next presence:update.
 */
async function emitSnapshot(socket: Socket, db: Db, runtime: EngineRuntime, presence: Presence, draftId: string, leagueId: string): Promise<void> {
  const userId = (socket.data as SocketData).userId;
  const [state, myTeamId, commissioner, connectedTeamIds] = await Promise.all([
    runtime.getOrHydrate(draftId),
    findOwnedTeamId(db, userId, leagueId),
    isCommissioner(db, userId, leagueId),
    presence.connectedTeamIds(draftId, leagueId),
  ]);
  socket.emit("state:snapshot", { ...toPublicSnapshot(state), myTeamId, isCommissioner: commissioner, connectedTeamIds });
}

export function registerSocketServer(httpServer: HttpServer, db: Db, runtime: EngineRuntime): Server {
  const io = new Server(httpServer, { cors: { origin: true } });
  io.use(createAuthMiddleware(db));
  const presence = createPresence(io, db);

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
      // Disconnected while the lookup above was in flight: the disconnect
      // handler has already run, so recording presence now would leak a
      // permanently "online" entry.
      if (socket.disconnected) return;
      const socketData = socket.data as SocketData;

      // A socket re-joining (the client re-sends join on every reconnect)
      // must not count twice, and one switching drafts leaves the old one.
      // Presence is updated synchronously together with socketData so the
      // disconnect handler always sees a matching add/remove pair.
      const previous = socketData.draftId && socketData.leagueId ? { draftId: socketData.draftId, leagueId: socketData.leagueId } : null;
      if (previous) presence.remove(previous.draftId, socketData.userId);
      socketData.draftId = draftId;
      socketData.leagueId = leagueId;
      presence.add(draftId, socketData.userId);

      if (previous && previous.draftId !== draftId) await socket.leave(roomForDraft(previous.draftId));
      await socket.join(roomForDraft(draftId));

      await emitSnapshot(socket, db, runtime, presence, draftId, leagueId);
      ack?.({ ok: true });

      if (previous && previous.draftId !== draftId) await presence.broadcast(previous.draftId, previous.leagueId);
      await presence.broadcast(draftId, leagueId);
    });

    socket.on("resync", async (_payload: unknown, ack?: (r: { ok: boolean }) => void) => {
      const draftId = (socket.data as SocketData).draftId;
      const leagueId = (socket.data as SocketData).leagueId;
      if (!draftId || !leagueId) {
        ack?.({ ok: false });
        return;
      }
      await emitSnapshot(socket, db, runtime, presence, draftId, leagueId);
      ack?.({ ok: true });
    });

    socket.on("disconnect", () => {
      const { userId, draftId, leagueId } = socket.data as SocketData;
      if (!draftId || !leagueId) return;
      presence.remove(draftId, userId);
      presence.broadcast(draftId, leagueId).catch((err) => console.error("presence broadcast failed", err));
    });
  });

  return io;
}
