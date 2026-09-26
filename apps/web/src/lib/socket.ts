import { io, type Socket } from "socket.io-client";
import { UNAUTHORIZED_EVENT } from "./api";
import type { Ack, JoinAck } from "./contracts";

export function createDraftSocket(token: string): Socket {
  const socket = io("/", { autoConnect: false, auth: { token } });
  // An expired or signed-out session: stop retrying and sign out, which sends the page to /login.
  socket.on("connect_error", (err) => {
    if (err.message !== "UNAUTHENTICATED") return;
    socket.disconnect();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  });
  return socket;
}

export function joinDraft(socket: Socket, draftId: string): Promise<JoinAck> {
  return new Promise((resolve) => socket.emit("join", { draftId }, resolve));
}

export function resync(socket: Socket): Promise<{ ok: boolean }> {
  return new Promise((resolve) => socket.emit("resync", {}, resolve));
}

export function emitIntent(socket: Socket, type: string, payload: Record<string, unknown>): Promise<Ack> {
  return new Promise((resolve) => socket.emit(type, payload, resolve));
}
