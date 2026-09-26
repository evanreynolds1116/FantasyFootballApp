import { MAX_BUDGET_ADJUSTMENT, openRosterSlots, remainingBudget, type RosterSlot } from "@draft-app/engine";
import { useState } from "react";
import type { DraftSnapshot } from "../../lib/contracts";
import { asEngineState } from "../../store/selectors";
import { acquiredLabel } from "../rosters/rosterData";
import { PlayerSearch } from "./PlayerSearch";
import { useAdminIntent } from "./useAdminIntent";

const inputClass = "h-11 w-full rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent";
const smallButton = "h-9 flex-shrink-0 rounded-lg border border-line px-3 text-sm font-semibold disabled:opacity-40";

/** "$25", "-10", "−10" → a number (NaN if it isn't one). */
function parseDollars(text: string): number {
  return Number(text.replace(/[$,\s]/g, "").replace("−", "-"));
}

/**
 * SPEC FR-14 "edit budget/roster". Budget changes are ± adjustments with a
 * reason; roster changes take a player off (back to the pool, any auction
 * price refunded) or put an available player into a spot the team has open.
 * Adding only ever fills an open spot, so no roster can end up too big.
 * Everything is announced to the league and kept in the draft log.
 */
export function RosterEditPanel({ snapshot, disabled }: { snapshot: DraftSnapshot; disabled: boolean }) {
  const teams = [...snapshot.teams].sort((a, b) => a.draftNumber - b.draftNumber);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const budgetIntent = useAdminIntent();
  const rosterIntent = useAdminIntent();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [slot, setSlot] = useState<RosterSlot>("auction");
  const [price, setPrice] = useState("");

  const state = asEngineState(snapshot);
  const team = teams.find((t) => t.id === teamId);
  if (!team) return null;
  const left = remainingBudget(state, team.id);
  const open = openRosterSlots(state, team.id);
  const roster = snapshot.picks.filter((p) => p.teamId === team.id).sort((a, b) => a.pickNo - b.pickNo);
  const playerOf = (id: string) => snapshot.players.find((p) => p.id === id);
  const blocked = snapshot.phase === "makeup" ? "Rosters can't be changed during the make-up round. Budgets still can." : null;

  const parsedAmount = parseDollars(amount);
  const amountValid = Number.isInteger(parsedAmount) && parsedAmount !== 0 && Math.abs(parsedAmount) <= MAX_BUDGET_ADJUSTMENT;
  const applyBudget = async () => {
    const ack = await budgetIntent.send("admin:adjustBudget", { teamId: team.id, amount: parsedAmount, reason: reason.trim() });
    if (ack.ok) {
      setAmount("");
      setReason("");
    }
  };

  const remove = async (pickId: string) => {
    const ack = await rosterIntent.send("admin:removePick", { pickId });
    if (ack.ok) setRemoving(null);
  };

  const effectiveSlot: RosterSlot | null = open[slot] > 0 ? slot : open.auction > 0 ? "auction" : open.snake > 0 ? "snake" : null;
  const parsedPrice = parseDollars(price);
  const priceValid = price.trim() !== "" && Number.isInteger(parsedPrice) && parsedPrice >= 0 && parsedPrice <= left;
  const add = async (playerId: string) => {
    if (!effectiveSlot) return;
    const ack = await rosterIntent.send("admin:assignPlayer", {
      teamId: team.id,
      playerId,
      slot: effectiveSlot,
      ...(effectiveSlot === "auction" ? { price: parsedPrice } : {}),
    });
    if (ack.ok) setPrice("");
  };

  return (
    <section aria-labelledby="edit-rosters" className="flex flex-col gap-3 rounded-[14px] bg-surface p-3.5">
      <h2 id="edit-rosters" className="label">
        Edit rosters &amp; budgets
      </h2>
      <div role="group" aria-label="Team" className="grid grid-cols-6 gap-1.5">
        {teams.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={t.id === team.id}
            aria-label={`Team ${t.draftNumber}, ${t.name}`}
            onClick={() => {
              setTeamId(t.id);
              setRemoving(null);
            }}
            className={`h-10 rounded-lg text-[15px] font-bold ${t.id === team.id ? "bg-text text-bg" : "border border-line"}`}
          >
            {t.draftNumber}
          </button>
        ))}
      </div>
      <div className="text-[15px]">
        <span className="font-semibold">
          Team {team.draftNumber} · {team.name}
        </span>
        <span className="text-muted">
          {" · "}${left} left · {roster.length} of {snapshot.settings.rosterSize} players
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-muted">Adjust budget</span>
        <div className="grid grid-cols-[7rem_1fr] gap-1.5">
          <input aria-label="Amount, negative to take money away" placeholder="+25 or -10" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          <input aria-label="Reason" placeholder="Reason (everyone sees it)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
        </div>
        <button
          type="button"
          disabled={disabled || budgetIntent.busy || !amountValid || !reason.trim()}
          onClick={() => void applyBudget()}
          className="h-11 rounded-ctl border border-line text-[15px] font-semibold disabled:opacity-40"
        >
          {amountValid ? `Apply · $${left} → $${left + parsedAmount}` : "Apply"}
        </button>
        {budgetIntent.error && (
          <div role="alert" className="text-sm font-semibold text-warn">
            {budgetIntent.error}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-muted">Roster</span>
        {roster.length === 0 && <div className="text-sm text-muted">No players yet.</div>}
        {roster.length > 0 && (
          <ul className="flex flex-col rounded-ctl border border-line">
            {roster.map((pick) => {
              const player = playerOf(pick.playerId);
              const name = player?.name ?? "Unknown player";
              return (
                <li key={pick.id} className="flex flex-col gap-2 border-b border-line px-3 py-1.5 text-sm last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{name}</span>
                      <span className="text-muted">
                        {" · "}
                        {player?.position ?? ""} · {acquiredLabel(pick)}
                      </span>
                    </span>
                    {removing !== pick.id && (
                      <button type="button" disabled={disabled || !!blocked} onClick={() => setRemoving(pick.id)} className={`${smallButton} text-warn`}>
                        Remove
                      </button>
                    )}
                  </div>
                  {removing === pick.id && (
                    <div role="alertdialog" aria-label={`Remove ${name}?`} className="flex flex-col gap-2 rounded-lg bg-warn-bg p-2.5">
                      <span className="font-semibold text-warn">
                        Take {name} off Team {team.draftNumber}? The player goes back in the pool
                        {pick.price !== null ? ` and $${pick.price} goes back to the team` : ""}.
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setRemoving(null)} className="h-9 rounded-lg border border-line font-semibold">
                          Keep
                        </button>
                        <button
                          type="button"
                          disabled={disabled || rosterIntent.busy}
                          onClick={() => void remove(pick.id)}
                          className="h-9 rounded-lg bg-warn font-bold text-on-accent disabled:opacity-40"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-muted">
          Add a player · open spots: {open.auction} auction, {open.snake} snake
        </span>
        {blocked ? (
          <div className="text-sm text-muted">{blocked}</div>
        ) : !effectiveSlot ? (
          <div className="text-sm text-muted">No open spot — the team&apos;s remaining turns will fill its roster. Remove a player first to put someone else in.</div>
        ) : (
          <>
            {open.auction > 0 && open.snake > 0 && (
              <div role="radiogroup" aria-label="Which spot" className="grid grid-cols-2 gap-1.5">
                {(["auction", "snake"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={effectiveSlot === s}
                    onClick={() => setSlot(s)}
                    className={`h-10 rounded-lg text-sm font-semibold ${effectiveSlot === s ? "bg-text text-bg" : "border border-line"}`}
                  >
                    {s === "auction" ? "Auction spot" : "Snake spot"}
                  </button>
                ))}
              </div>
            )}
            {effectiveSlot === "auction" && (
              <input aria-label="Price paid" inputMode="numeric" placeholder={`Price paid, $0–$${left}`} value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} />
            )}
            {effectiveSlot === "auction" && snapshot.phase === "auction" && (
              <div className="text-[13px] text-muted">The team could still win this spot in the auction; adding a player fills it now.</div>
            )}
            <PlayerSearch
              // A fresh (empty) search after each roster change.
              key={`${team.id}:${roster.length}`}
              snapshot={snapshot}
              label={`Find a player to add to Team ${team.draftNumber}`}
              action={(p) => (
                <button
                  type="button"
                  disabled={disabled || rosterIntent.busy || (effectiveSlot === "auction" && !priceValid)}
                  onClick={() => void add(p.id)}
                  className={smallButton}
                >
                  Add{effectiveSlot === "auction" && priceValid ? ` · $${parsedPrice}` : ""}
                </button>
              )}
            />
          </>
        )}
        {rosterIntent.error && (
          <div role="alert" className="text-sm font-semibold text-warn">
            {rosterIntent.error}
          </div>
        )}
      </div>
    </section>
  );
}
