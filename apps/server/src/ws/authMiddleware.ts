import type { Socket } from "socket.io";
import type { Db } from "../db/client.js";
import { resolveToken } from "../http/sessions.js";
import type { SocketData } from "./types.js";

/** Socket.IO connection middleware: resolves handshake.auth.token, rejects the connection otherwise. */
export function createAuthMiddleware(db: Db) {
  return async (socket: Socket, next: (err?: Error) => void) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error("UNAUTHENTICATED"));
      return;
    }
    const userId = await resolveToken(db, token);
    if (!userId) {
      next(new Error("UNAUTHENTICATED"));
      return;
    }
    (socket.data as SocketData).userId = userId;
    next();
  };
}
