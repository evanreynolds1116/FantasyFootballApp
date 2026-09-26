import { remainingBudget, type Lot } from "@draft-app/engine";
import { useCountdown } from "../../lib/useCountdown";
import type { PublicBid } from "../../lib/contracts";
import { useDraft } from "../../store/DraftProvider";
import { asEngineState } from "../../store/selectors";
import { useTieRebidForm } from "./useTieRebidForm";

/** My most recent standing bid on `lot` as of `atRound` — walks backward through already-visible rounds, mirroring the engine's own effectiveBidAmount (never re-deciding validity, just displaying what the server already shows). */
function effectiveAmount(bids: PublicBid[], lotId: string, teamId: string, atRound: number): number | null {
  for (let round = atRound; round >= 0; round -= 1) {
    const bid = bids.find((b) => b.lotId === lotId && b.teamId === teamId && b.tieRound === round && !b.superseded);
    if (bid) return bid.amount ?? null;
  }
  return null;
}

export function TieRebidScreen({ lot }: { lot: Lot }) {
  const { snapshot, socket } = useDraft();
  const myTeamId = snapshot?.myTeamId ?? null;
  const amInTie = myTeamId !== null && lot.tiedTeamIds.includes(myTeamId);

  // Every hook below is called unconditionally regardless of amInTie/snapshot
  // presence — amInTie can flip true→false mid-mount (getting knocked out
  // while viewing this exact screen), so branching JSX only (never skipping
  // a hook call) is required to avoid a real "rendered fewer hooks" crash.
  const { label: clockLabel } = useCountdown(lot.endsAt, snapshot?.paused ?? false);
  const myPrevious = snapshot && myTeamId ? effectiveAmount(snapshot.bids, lot.id, myTeamId, lot.tieRound - 1) : null;
  const minRequired = (myPrevious ?? 0) + (snapshot?.settings.tieMinRaise ?? 0);
  const budget = snapshot && myTeamId ? remainingBudget(asEngineState(snapshot), myTeamId) : 0;
  const hasServerBid =
    !!snapshot && myTeamId !== null && snapshot.bids.some((b) => b.lotId === lot.id && b.teamId === myTeamId && b.tieRound === lot.tieRound && !b.superseded);
  const form = useTieRebidForm({ socket, lotId: lot.id, tieRound: lot.tieRound, minRequired, budget, hasServerBid });

  if (!snapshot) return null;

  const player = snapshot.players.find((p) => p.id === lot.playerId);
  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));

  const priorRounds: { round: number; bids: { teamId: string; amount: number }[] }[] = [];
  for (let round = 0; round < lot.tieRound; round += 1) {
    const roundBids = snapshot.bids
      .filter((b) => b.lotId === lot.id && b.tieRound === round && !b.superseded && b.amount !== undefined)
      .map((b) => ({ teamId: b.teamId, amount: b.amount as number }));
    if (roundBids.length > 0) priorRounds.push({ round, bids: roundBids });
  }

  if (!amInTie) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-grow flex-col gap-4 py-2">
        <div className="flex justify-between text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
          <span>
            Lot {lot.orderInRound} · {player?.name} · {player?.position}
          </span>
          <span>Tie-break round {lot.tieRound}</span>
        </div>
        <div className="rounded-panel border border-line bg-surface px-5 py-5">
          <div className="text-[15px] text-muted">Tie-break in progress</div>
          <div className="mt-1 text-lg font-semibold">
            {lot.tiedTeamIds.map((id) => `Team ${teamById.get(id)?.draftNumber ?? "?"}`).join(" vs ")}
          </div>
        </div>
        <div className="flex items-center justify-center rounded-panel border border-line bg-surface px-5 py-6">
          <span className="font-display text-4xl font-extrabold text-accent">{clockLabel}</span>
        </div>
      </div>
    );
  }

  const others = lot.tiedTeamIds.filter((id) => id !== myTeamId);
  const tiedWithLabel = others.map((id) => `Team ${teamById.get(id)?.draftNumber ?? "?"}`).join(", ");

  const bump = (delta: number) => {
    const n = parseInt(form.amount || String(minRequired), 10);
    form.setAmount(String(Math.max(minRequired, n + delta)));
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-grow flex-col gap-4 py-2">
      <div className="flex justify-between text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
        <span>
          Lot {lot.orderInRound} · {player?.name} · {player?.position}
        </span>
        <span>Tie-break round {lot.tieRound}</span>
      </div>

      <div className="flex items-center justify-between rounded-panel border-2 border-warn-border bg-warn-bg px-4.5 py-4.5">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-warn">You&apos;re still tied</span>
          <span className="text-[17px] font-semibold">With {tiedWithLabel || "another team"} at ${myPrevious}</span>
        </div>
        <span className="font-display text-4xl font-extrabold">{clockLabel}</span>
      </div>

      {priorRounds.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="label">How we got here</div>
          <div className="flex flex-col gap-1.5 rounded-[14px] bg-surface px-3.5 py-3.5">
            {priorRounds.map(({ round, bids }) =>
              round === 0 ? (
                <div key="original" className="text-[13px] text-muted">
                  Original bids: tie at ${Math.max(...bids.map((b) => b.amount))}
                </div>
              ) : (
                <div key={round} className="flex flex-col gap-1.5">
                  <div className="mt-1.5 text-[13px] text-muted">Re-bid round {round}</div>
                  {bids.map((b) => {
                    const stillIn = lot.tiedTeamIds.includes(b.teamId);
                    const isMe = b.teamId === myTeamId;
                    return (
                      <div key={b.teamId} className={`flex justify-between text-base ${stillIn ? "" : "text-muted"}`}>
                        <span>
                          Team {teamById.get(b.teamId)?.draftNumber ?? "?"}
                          {isMe ? " · You" : ""}
                          {!stillIn ? " · out" : ""}
                        </span>
                        <span className={`font-bold ${stillIn ? "" : "line-through"}`}>${b.amount}</span>
                      </div>
                    );
                  })}
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {form.isSubmitted ? (
        <div className="flex items-center gap-4 rounded-panel border-2 border-success-border bg-success-bg px-5 py-5">
          <div className="flex flex-grow flex-col gap-0.5">
            <span className="text-[15px] font-bold text-success">Your re-bid is in and hidden</span>
            <span className="font-display text-4xl font-extrabold">{form.submittedAmount !== null ? `$${form.submittedAmount}` : "•••"}</span>
          </div>
          <button type="button" onClick={form.change} className="h-12 rounded-ctl border border-success-border bg-transparent px-4 text-base font-semibold text-text">
            Change bid
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor="tie-rebid" className="text-sm text-muted">
            Your new bid · at least <strong className="text-text">${minRequired}</strong> · you have ${budget}
          </label>
          <div className="flex items-stretch gap-2">
            <button type="button" aria-label="Lower by $5" onClick={() => bump(-5)} className="w-14 rounded-ctl bg-surface-2 text-2xl font-semibold">
              −
            </button>
            <input
              id="tie-rebid"
              inputMode="numeric"
              value={`$${form.amount === "" ? minRequired : form.amount}`}
              onChange={(e) => form.setAmount(e.target.value)}
              className="font-display h-[72px] min-w-0 flex-grow rounded-panel border-2 border-accent bg-surface-sunk text-center text-[44px] font-extrabold text-text outline-none"
            />
            <button type="button" aria-label="Raise by $5" onClick={() => bump(5)} className="w-14 rounded-ctl bg-surface-2 text-2xl font-semibold">
              +
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[5, 10, 25, 50].map((inc) => (
              <button key={inc} type="button" onClick={() => bump(inc)} className="h-11 rounded-ctl border border-line text-[15px] font-semibold">
                +${inc}
              </button>
            ))}
          </div>
          {form.previousBidStands && <div className="text-sm text-muted">Your previous bid of ${myPrevious} stays in if you don&apos;t re-bid in time.</div>}
          {form.error && (
            <div role="alert" className="text-sm font-semibold text-warn">
              {form.error}
            </div>
          )}
          <div className="text-sm text-muted">
            If you don&apos;t re-bid in time, your ${myPrevious} stands and loses to any higher re-bid. Everyone sees the re-bids after this round.
          </div>
          <button
            type="button"
            onClick={() => void form.submit()}
            className="mt-auto h-14 rounded-panel bg-accent text-lg font-bold uppercase tracking-[0.04em] text-on-accent"
          >
            Lock in re-bid
          </button>
        </div>
      )}
    </div>
  );
}
