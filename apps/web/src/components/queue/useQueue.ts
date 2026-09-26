import { isPlayerAvailable } from "@draft-app/engine";
import { useState } from "react";
import { emitIntent } from "../../lib/socket";
import { useDraft } from "../../store/DraftProvider";
import { asEngineState } from "../../store/selectors";

/**
 * The viewer's ranked queue during a draft (FR-19). Edits send the whole new
 * list as one `queue:update`; the server's `you:private` reply (to every tab
 * this manager has open) is what updates the snapshot, with the optimistic
 * copy here only bridging the round trip.
 */
export function useQueue() {
  const { snapshot, socket } = useDraft();
  const [pending, setPending] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const stored = snapshot?.myQueue ?? [];
  const queue = pending ?? stored;
  const canQueue = !!snapshot?.myTeamId && snapshot.phase !== "complete";

  const save = async (next: string[]) => {
    setPending(next);
    setError("");
    const ack = await emitIntent(socket, "queue:update", { playerIds: next });
    if (!ack.ok) setError(ack.message);
    setPending(null);
  };

  /** Queued players who can still be nominated or picked, in queue order. */
  const available = snapshot ? queue.filter((id) => isPlayerAvailable(asEngineState(snapshot), id)) : [];

  return {
    queue,
    available,
    canQueue,
    error,
    isQueued: (id: string) => queue.includes(id),
    toggle: (id: string) => void save(queue.includes(id) ? queue.filter((q) => q !== id) : [...queue, id]),
    remove: (id: string) => void save(queue.filter((q) => q !== id)),
    /** Moves a player up (-1) or down (+1) among the *available* entries, keeping taken ones where they are. */
    move: (id: string, delta: -1 | 1) => {
      const i = available.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= available.length) return;
      const a = queue.indexOf(available[i]!);
      const b = queue.indexOf(available[j]!);
      const next = [...queue];
      [next[a], next[b]] = [next[b]!, next[a]!];
      void save(next);
    },
  };
}
