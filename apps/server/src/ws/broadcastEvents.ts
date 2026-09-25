import { remainingBudget, rosterCount, type DraftState, type Event } from "@draft-app/engine";
import type { Server } from "socket.io";
import { toPublicSnapshot } from "../shared/publicSnapshot.js";

export function roomForDraft(draftId: string): string {
  return `draft:${draftId}`;
}

/**
 * Translates engine events into SPEC.md's room broadcasts. draft:rejected is
 * filtered out unconditionally — it only ever exists in the one-caller
 * ReduceResult returned from applyAction, sent via the WS ack callback, never
 * via a room broadcast. admin:undo triggers a full state:snapshot resync
 * rather than a bespoke wire event, since undo is rare and correctness beats
 * chattiness there.
 */
export function broadcastEvents(io: Server, draftId: string, state: DraftState, events: Event[]): void {
  const room = roomForDraft(draftId);
  const envelope = { version: state.version };

  for (const event of events) {
    switch (event.type) {
      case "draft:rejected":
        continue;
      case "draft:undo":
        io.to(room).emit("state:snapshot", { ...toPublicSnapshot(state), ...envelope });
        continue;
      case "lot:awarded": {
        io.to(room).emit("lot:awarded", {
          ...event,
          ...envelope,
          remainingBudget: remainingBudget(state, event.teamId),
          rosterCount: rosterCount(state, event.teamId),
        });
        continue;
      }
      default:
        io.to(room).emit(event.type, { ...event, ...envelope });
    }
  }
}
