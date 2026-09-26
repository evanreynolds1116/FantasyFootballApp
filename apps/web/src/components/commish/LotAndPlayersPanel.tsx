import { currentLot } from "@draft-app/engine";
import { useEffect, useState } from "react";
import type { DraftSnapshot } from "../../lib/contracts";
import { asEngineState } from "../../store/selectors";
import { PlayerSearch } from "./PlayerSearch";
import { useAdminIntent } from "./useAdminIntent";

const smallButton = "h-9 flex-shrink-0 rounded-lg border border-line px-3 text-sm font-semibold disabled:opacity-40";

/**
 * SPEC edge case "late-breaking injury": void the lot being bid on (or in a
 * tie re-bid) — nobody gets the player and no bid is revealed — and mark
 * players unavailable, or available again. Every change is announced to
 * the league.
 */
export function LotAndPlayersPanel({ snapshot, disabled }: { snapshot: DraftSnapshot; disabled: boolean }) {
  const voidIntent = useAdminIntent();
  const playerIntent = useAdminIntent();
  const [confirming, setConfirming] = useState(false);
  const lot = currentLot(asEngineState(snapshot));
  const voidable = lot && (lot.state === "open" || lot.state === "tieRebid") ? lot : null;
  const lotPlayer = voidable ? snapshot.players.find((p) => p.id === voidable.playerId) : undefined;
  const unavailable = snapshot.unavailablePlayerIds.map((id) => snapshot.players.find((p) => p.id === id)).filter((p) => p !== undefined);
  const live = snapshot.phase !== "complete";

  useEffect(() => setConfirming(false), [voidable?.id]);

  const voidLot = async (alsoUnavailable: boolean) => {
    if (!voidable) return;
    const ack = await voidIntent.send("admin:voidLot", { lotId: voidable.id });
    if (ack.ok && alsoUnavailable) await playerIntent.send("admin:markPlayerUnavailable", { playerId: voidable.playerId });
    if (ack.ok) setConfirming(false);
  };

  return (
    <section aria-labelledby="lot-players" className="flex flex-col gap-3 rounded-[14px] bg-surface p-3.5">
      <h2 id="lot-players" className="label">
        Injuries &amp; voiding a lot
      </h2>

      {voidable &&
        (confirming ? (
          <div role="alertdialog" aria-labelledby="void-confirm" className="flex flex-col gap-3 rounded-[14px] border-2 border-warn-border bg-warn-bg p-3.5">
            <div id="void-confirm" className="text-[15px] font-bold text-warn">
              Void the lot for {lotPlayer?.name ?? "this player"}?
            </div>
            <div className="text-sm">Nobody gets the player and the bids on the lot stay sealed forever. The draft moves on to the next lot.</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => setConfirming(false)} className="h-11 rounded-ctl border border-line text-[15px] font-semibold">
                Keep it
              </button>
              <button
                type="button"
                disabled={disabled || voidIntent.busy}
                onClick={() => void voidLot(false)}
                className="h-11 rounded-ctl border border-warn-border text-[15px] font-bold text-warn disabled:opacity-40"
              >
                Void, back to pool
              </button>
              <button
                type="button"
                disabled={disabled || voidIntent.busy}
                onClick={() => void voidLot(true)}
                className="h-11 rounded-ctl bg-warn text-[15px] font-bold text-on-accent disabled:opacity-40"
              >
                Void &amp; mark injured
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setConfirming(true)}
            className="min-h-[48px] rounded-ctl border border-warn-border px-3 text-[15px] font-semibold text-warn disabled:opacity-40"
          >
            Void this lot · {lotPlayer?.name ?? "current player"}
          </button>
        ))}
      {voidIntent.error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {voidIntent.error}
        </div>
      )}

      {live && (
        <PlayerSearch
          snapshot={snapshot}
          label="Find a player to mark unavailable"
          action={(p) => (
            <button
              type="button"
              disabled={disabled || playerIntent.busy}
              onClick={() => void playerIntent.send("admin:markPlayerUnavailable", { playerId: p.id })}
              className={`${smallButton} text-warn`}
            >
              Mark unavailable
            </button>
          )}
        />
      )}
      {unavailable.length > 0 && (
        <ul aria-label="Unavailable players" className="flex flex-col rounded-ctl border border-line">
          {unavailable.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-sm last:border-b-0">
              <span className="min-w-0 truncate">
                <span className="font-semibold text-muted line-through">{p.name}</span>
                <span className="text-muted"> · {p.position} · unavailable</span>
              </span>
              <button
                type="button"
                disabled={disabled || playerIntent.busy}
                onClick={() => void playerIntent.send("admin:markPlayerAvailable", { playerId: p.id })}
                className={smallButton}
              >
                Mark available
              </button>
            </li>
          ))}
        </ul>
      )}
      {playerIntent.error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {playerIntent.error}
        </div>
      )}
      <div className="text-[13px] text-muted">Unavailable players can&apos;t be nominated, picked or auto-picked. Everyone sees each change.</div>
    </section>
  );
}
