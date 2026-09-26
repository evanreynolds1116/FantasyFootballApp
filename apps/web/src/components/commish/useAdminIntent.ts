import { useCallback, useState } from "react";
import type { Ack } from "../../lib/contracts";
import { emitIntent } from "../../lib/socket";
import { useDraft } from "../../store/DraftProvider";

/**
 * Sends one `admin:*` intent and tracks its in-flight/error state. The
 * server's ack is the only word on whether it worked — the console never
 * assumes success, it just waits for the resulting snapshot.
 */
export function useAdminIntent() {
  const { socket } = useDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = useCallback(
    async (type: string, payload: Record<string, unknown> = {}): Promise<Ack> => {
      setBusy(true);
      setError("");
      try {
        const ack = await emitIntent(socket, type, payload);
        if (!ack.ok) setError(ack.message);
        return ack;
      } finally {
        setBusy(false);
      }
    },
    [socket],
  );

  return { send, busy, error, clearError: () => setError("") };
}
