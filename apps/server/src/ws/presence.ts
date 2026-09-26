import { eq } from "drizzle-orm";
import type { Server } from "socket.io";
import type { Db } from "../db/client.js";
import { team } from "../db/schema.js";
import { roomForDraft } from "./broadcastEvents.js";

/**
 * Tracks which users have at least one socket joined to each draft, so the
 * commissioner console can show "who's connected" per team (SPEC.md's
 * Commissioner console; "commissioner sees them offline and can pause to
 * wait"). In-memory only: presence is live connection state, not draft
 * state, so it's never persisted and never goes through the engine. After a
 * server restart it rebuilds itself as clients reconnect and re-join.
 */
export type Presence = {
  /** Records one more joined socket for this user; returns nothing — call broadcast after. */
  add(draftId: string, userId: string): void;
  /** Records one fewer joined socket for this user (a second tab closing keeps the user online). */
  remove(draftId: string, userId: string): void;
  /** Teams in the league whose owner currently has at least one socket joined to this draft. */
  connectedTeamIds(draftId: string, leagueId: string): Promise<string[]>;
  /** Emits `presence:update` { connectedTeamIds } to everyone in the draft's room. */
  broadcast(draftId: string, leagueId: string): Promise<void>;
};

export function createPresence(io: Server, db: Db): Presence {
  // draftId -> userId -> number of joined sockets
  const byDraft = new Map<string, Map<string, number>>();

  const presence: Presence = {
    add(draftId, userId) {
      const users = byDraft.get(draftId) ?? new Map<string, number>();
      users.set(userId, (users.get(userId) ?? 0) + 1);
      byDraft.set(draftId, users);
    },

    remove(draftId, userId) {
      const users = byDraft.get(draftId);
      if (!users) return;
      const next = (users.get(userId) ?? 0) - 1;
      if (next > 0) users.set(userId, next);
      else users.delete(userId);
      if (users.size === 0) byDraft.delete(draftId);
    },

    async connectedTeamIds(draftId, leagueId) {
      const users = byDraft.get(draftId);
      if (!users) return [];
      const teams = await db.select({ id: team.id, userId: team.userId }).from(team).where(eq(team.leagueId, leagueId));
      return teams.filter((t) => t.userId !== null && users.has(t.userId)).map((t) => t.id);
    },

    async broadcast(draftId, leagueId) {
      const connectedTeamIds = await presence.connectedTeamIds(draftId, leagueId);
      io.to(roomForDraft(draftId)).emit("presence:update", { connectedTeamIds });
    },
  };
  return presence;
}
