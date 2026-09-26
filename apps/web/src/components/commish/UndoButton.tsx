import { useEffect, useState } from "react";
import type { DraftSnapshot } from "../../lib/contracts";
import { undoConsequence, undoDescription } from "./consoleText";
import { useAdminIntent } from "./useAdminIntent";

/**
 * "Undo last result", warn style, naming exactly what it undoes, with a
 * confirm step before acting (UI.md). Only ever the most recent award or
 * pick — that's all the engine's admin:undo can do.
 */
export function UndoButton({ snapshot, disabled }: { snapshot: DraftSnapshot; disabled: boolean }) {
  const { send, busy, error } = useAdminIntent();
  const [confirming, setConfirming] = useState(false);
  const description = undoDescription(snapshot);

  // If the thing being confirmed changes underneath (a new award lands, or
  // another tab already undid it), drop the confirm rather than undo
  // something the commissioner never saw named.
  const lastPickId = snapshot.lastAwardOrPick?.pickId ?? null;
  useEffect(() => setConfirming(false), [lastPickId]);

  if (!description) {
    return (
      <button type="button" disabled className="h-[52px] rounded-ctl border border-line text-[15px] font-semibold text-muted">
        Nothing to undo yet
      </button>
    );
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setConfirming(true)}
          className="min-h-[52px] rounded-ctl border border-warn-border px-3 py-2 text-[15px] font-semibold text-warn disabled:opacity-40"
        >
          Undo last result · {description}
        </button>
        {error && (
          <div role="alert" className="text-sm font-semibold text-warn">
            {error}
          </div>
        )}
      </div>
    );
  }

  const confirm = async () => {
    const ack = await send("admin:undo");
    if (ack.ok) setConfirming(false);
  };

  return (
    <div role="alertdialog" aria-labelledby="undo-confirm-title" className="flex flex-col gap-3 rounded-[14px] border-2 border-warn-border bg-warn-bg p-3.5">
      <div id="undo-confirm-title" className="text-[15px] font-bold text-warn">
        Undo {description}?
      </div>
      <div className="text-sm text-text">{undoConsequence(snapshot)}</div>
      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setConfirming(false)} className="h-11 rounded-ctl border border-line text-[15px] font-semibold">
          Keep it
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void confirm()}
          className="h-11 rounded-ctl bg-warn text-[15px] font-bold text-on-accent disabled:opacity-40"
        >
          Yes, undo it
        </button>
      </div>
    </div>
  );
}
