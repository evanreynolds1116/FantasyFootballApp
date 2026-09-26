import { io, type Socket } from "socket.io-client";
import type { Ack, JoinAck } from "./contracts";

export function createDraftSocket(token: string): Socket {
  return io("/", { autoConnect: false, auth: { token } });
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
