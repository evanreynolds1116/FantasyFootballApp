import { auctionSpotsFilled as engineAuctionSpotsFilled, currentLot, remainingBudget, REVEAL_HOLD_MS } from "@draft-app/engine";
import { useEffect, useMemo, useState } from "react";
import { useCountdown } from "../../lib/useCountdown";
import type { RevealPayload } from "../../lib/contracts";
import { useDraft } from "../../store/DraftProvider";
import { asEngineState } from "../../store/selectors";
import { fireCue } from "../alerts/cues";
import { countUpValue, planReveal, SEALED_MS } from "./revealTimeline";

/** How long the winner's own "You won!" takeover stays up. */
const YOU_WON_MS = 2400;

/** Milliseconds since the reveal began, ticking while the show plays. */
function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t - startedAt > REVEAL_HOLD_MS) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [startedAt]);
  return now - startedAt;
}

/**
 * The reveal as a short show (UI.md §3): sealed cards shake to a drumroll,
 * runner-ups flip lowest first, "And the winner is…", then the winner's card
 * slams down with the price counting up — or "It's a tie!". Every screen
 * plays it from the same `lot:reveal` message, and the server holds the next
 * clock until it's over. Bid amounts come ONLY from that message; bids the
 * reveal setting hides stay face-down cards, counted but never shown.
 */
export function RevealScreen({ reveal, withSound = false }: { reveal: RevealPayload; withSound?: boolean }) {
  const { snapshot } = useDraft();
  const { label: dismissLabel } = useCountdown(reveal.until, false, { ignoreHold: true });
  const startedAt = reveal.until - REVEAL_HOLD_MS;
  const elapsed = useElapsed(startedAt);
  const plan = useMemo(() => planReveal(reveal.bids, reveal.winnerTeamId), [reveal.bids, reveal.winnerTeamId]);
  const myTeamId = snapshot?.myTeamId ?? null;
  const iWon = myTeamId !== null && reveal.winnerTeamId === myTeamId;

  // The show's sounds, scheduled once per reveal from wherever it is now (a late mount skips what's past).
  useEffect(() => {
    if (!withSound) return;
    const since = Date.now() - startedAt;
    const at = (ms: number, cue: Parameters<typeof fireCue>[0]) => (ms >= since ? [setTimeout(() => fireCue(cue), ms - since)] : []);
    const timers = [
      ...plan.ticks.flatMap((t) => at(t, "tick")),
      ...plan.flips.flatMap((f) => at(f.at, "thud")),
      ...(plan.top.length > 0 ? at(plan.topAt, iWon ? "won" : "reveal") : at(plan.topAt, "thud")),
    ];
    return () => timers.forEach(clearTimeout);
  }, [withSound, startedAt, plan, iWon]);

  if (!snapshot) return null;
  const state = asEngineState(snapshot);
  const lot = snapshot.lots.find((l) => l.id === reveal.lotId);
  const player = lot ? snapshot.players.find((p) => p.id === lot.playerId) : undefined;
  const nominator = lot ? snapshot.teams.find((t) => t.id === lot.nominatedByTeamId) : undefined;
  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));
  const teamLabel = (id: string) => {
    const t = teamById.get(id);
    return `Team ${t?.draftNumber ?? "?"} · ${id === myTeamId ? "You" : (t?.name ?? "—")}`;
  };

  // Every locked-in entry was a face-down card until now: bids and passes look the same before the reveal.
  const entries = snapshot.bids.filter((b) => b.lotId === reveal.lotId && b.tieRound === 0 && !b.superseded).length;
  const cardCount = reveal.afterTie ? reveal.bids.length : Math.max(entries, reveal.bids.length + reveal.passes);
  const hiddenCount = reveal.afterTie ? 0 : Math.max(0, cardCount - reveal.bids.length - reveal.passes);

  const topShown = elapsed >= plan.topAt;
  const detailsShown = elapsed >= plan.detailsAt;
  const flipped = plan.flips.filter((f) => elapsed >= f.at).map((f) => f.bid);
  const faceDown = Math.max(0, cardCount - flipped.length - (topShown ? plan.top.length : 0));
  const sealedPhase = elapsed < SEALED_MS;
  const suspense = plan.suspenseAt !== null && elapsed >= plan.suspenseAt && !topShown;

  const winner = reveal.winnerTeamId ? teamById.get(reveal.winnerTeamId) : undefined;
  const winnerPrice = lot?.price ?? plan.top[0]?.amount ?? null;
  const bestRunnerUp = plan.flips.length > 0 ? Math.max(...plan.flips.map((f) => f.bid.amount)) : null;
  const shownPrice = winnerPrice !== null ? countUpValue(bestRunnerUp ?? 0, winnerPrice, elapsed - plan.topAt) : null;

  const noBidOutcome =
    reveal.bids.length === 0 && lot
      ? lot.state === "awarded"
        ? `No bids — awarded to Team ${nominator?.draftNumber ?? "?"} (the nominator) at the minimum bid.`
        : lot.state === "returnedToPool"
          ? "No bids — back into the player pool."
          : "No bids."
      : null;

  const upNext = currentLot(state);
  const upNextPlayer = upNext ? snapshot.players.find((p) => p.id === upNext.playerId) : undefined;
  const upNextNominator = upNext ? snapshot.teams.find((t) => t.id === upNext.nominatedByTeamId) : undefined;
  const winnerAfter = winner ? remainingBudget(state, winner.id) : null;
  const winnerBefore = winnerAfter !== null && winnerPrice !== null ? winnerAfter + winnerPrice : null;
  const winnerSpotsFilled = winner ? engineAuctionSpotsFilled(state, winner.id) : null;

  // Runner-ups as they flip, shown ranked (best first) under the top card.
  const ranked = [...flipped].sort((a, b) => b.amount - a.amount);
  const firstRank = plan.top.length + 1;
  const announcement = !topShown
    ? ""
    : plan.tie
      ? `It's a tie at $${plan.top[0]?.amount} between ${plan.top.map((b) => `Team ${teamById.get(b.teamId)?.draftNumber ?? "?"}`).join(" and ")}.`
      : winner
        ? `Team ${winner.draftNumber} wins ${player?.name ?? "the player"} for $${winnerPrice}.`
        : (noBidOutcome ?? "");

  return (
    <div className="relative mx-auto flex w-full max-w-xl flex-grow flex-col gap-4 py-2">
      <div className="flex justify-between text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
        <span>
          Round {lot?.round ?? "?"} · Lot {lot?.orderInRound ?? "?"}
        </span>
        <span>{topShown ? "Bids revealed" : "Bidding closed"}</span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted">
          {player?.position}
          {player?.nflTeam ? ` · ${player.nflTeam}` : ""}
        </span>
        <span className="font-display text-[40px] font-extrabold uppercase leading-none">{player?.name ?? "—"}</span>
      </div>

      {faceDown > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5" aria-hidden="true">
            {Array.from({ length: faceDown }, (_, i) => (
              <div
                key={i}
                className={`flex h-14 w-10 items-center justify-center rounded-lg border-2 font-display text-2xl font-extrabold ${
                  topShown ? "border-line bg-surface text-muted opacity-60" : `border-accent bg-chip text-accent ${elapsed > SEALED_MS - 800 && sealedPhase ? "reveal-shake-fast" : "reveal-shake"}`
                }`}
                style={{ animationDelay: `${(i * 37) % 140}ms` }}
              >
                {topShown ? <LockIcon /> : "?"}
              </div>
            ))}
          </div>
          <span className="text-sm text-muted">
            {topShown
              ? `${hiddenCount > 0 ? `${hiddenCount} bid${hiddenCount === 1 ? "" : "s"} stay${hiddenCount === 1 ? "s" : ""} sealed` : ""}${hiddenCount > 0 && reveal.passes > 0 ? " · " : ""}${reveal.passes > 0 ? `${reveal.passes} passed` : ""}`
              : sealedPhase
                ? `${cardCount} sealed ${cardCount === 1 ? "entry" : "entries"} · revealing…`
                : ""}
          </span>
        </div>
      )}

      {suspense && (
        <div className="reveal-pulse py-3 text-center font-display text-3xl font-extrabold uppercase text-accent">And the winner is…</div>
      )}

      {topShown && winner && (
        <div className={`reveal-slam flex flex-col gap-2.5 rounded-[18px] bg-accent px-5 py-5 text-on-accent ${iWon ? "ring-4 ring-text" : ""}`}>
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.08em]">
            <TrophyIcon />
            {iWon ? "You won!" : "Winner"}
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xl font-bold">Team {winner.draftNumber}</span>
              <span className="text-[15px]">{winner.name}</span>
            </div>
            <span className="font-display text-6xl font-extrabold leading-none tabular-nums">${shownPrice}</span>
          </div>
          {bestRunnerUp !== null && winnerPrice !== null && elapsed - plan.topAt > 900 && (
            <span className="reveal-fade-up text-sm font-bold">won by ${winnerPrice - bestRunnerUp}</span>
          )}
        </div>
      )}

      {topShown && plan.tie && (
        <div className="reveal-slam flex flex-col gap-2 rounded-[18px] border-2 border-warn-border bg-warn-bg px-5 py-4 text-warn">
          <span className="font-display text-4xl font-extrabold uppercase">It&apos;s a tie!</span>
          {plan.top.map((b) => (
            <div key={b.teamId} className="flex items-center justify-between text-[17px] font-semibold text-text">
              <span>{teamLabel(b.teamId)}</span>
              <span className="font-display text-2xl font-bold">${b.amount}</span>
            </div>
          ))}
          <span className="text-sm font-semibold">
            {plan.top.some((b) => b.teamId === myTeamId) ? "You're in the re-bid round next." : "The tied teams re-bid next."}
          </span>
        </div>
      )}

      {topShown && noBidOutcome && <div className="reveal-fade-up rounded-panel border border-line bg-surface px-5 py-4 text-muted">{noBidOutcome}</div>}

      {ranked.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-[14px] border border-line">
          {ranked.map((b, i) => (
            <div key={b.teamId} className={`reveal-flip flex items-center gap-3 bg-surface px-4 py-3.5 ${i > 0 ? "border-t border-line" : ""}`}>
              <span className="font-display w-7 text-xl font-bold text-muted">{firstRank + i}</span>
              <span className="flex-grow text-[17px] font-semibold">{teamLabel(b.teamId)}</span>
              <span className="font-display text-2xl font-bold">${b.amount}</span>
            </div>
          ))}
        </div>
      )}

      {detailsShown && winner && winnerAfter !== null && winnerBefore !== null && winnerSpotsFilled !== null && (
        <div className="reveal-fade-up grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-surface px-3 py-2.5">
            <div className="text-xs text-muted">Team {winner.draftNumber} budget</div>
            <div className="font-display text-xl font-bold">
              ${winnerBefore} → ${winnerAfter}
            </div>
          </div>
          <div className="rounded-xl bg-surface px-3 py-2.5">
            <div className="text-xs text-muted">Team {winner.draftNumber} auction spots</div>
            <div className="font-display text-xl font-bold">
              {winnerSpotsFilled} / {snapshot.settings.auctionSpots}
            </div>
          </div>
        </div>
      )}

      {detailsShown && upNext && upNext.id !== reveal.lotId && (
        <div className="reveal-fade-up mt-auto flex items-center justify-between rounded-[14px] border border-line bg-surface px-4 py-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-muted">Up next · Lot {upNext.orderInRound} · clock starts in</span>
            <span className="text-[17px] font-semibold">
              {upNextPlayer?.name} · {upNextPlayer?.position} · nominated by Team {upNextNominator?.draftNumber ?? "?"}
            </span>
          </div>
          <span className="font-display text-3xl font-extrabold text-accent">{dismissLabel}</span>
        </div>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {topShown && winner && elapsed - plan.topAt < 4000 && <Confetti pieces={iWon ? 90 : 36} />}
      {topShown && iWon && elapsed - plan.topAt < YOU_WON_MS && (
        <div aria-hidden="true" className="reveal-flash pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-accent/95 text-on-accent">
          <span className="font-display text-7xl font-extrabold uppercase">You won!</span>
          <span className="text-2xl font-bold">
            {player?.name} · ${winnerPrice}
          </span>
        </div>
      )}
    </div>
  );
}

const CONFETTI_COLORS = ["#F2B84B", "#8FD6A8", "#EEF2EC", "#FF9A7A", "#F7D58B"];

/** A burst of falling confetti (skipped entirely for anyone who prefers reduced motion). */
function Confetti({ pieces }: { pieces: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => {
        // Deterministic scatter from the index, so re-renders don't reshuffle it.
        const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
        return {
          left: `${r(1) * 100}%`,
          size: 6 + r(2) * 7,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
          style: {
            "--drift": `${(r(3) - 0.5) * 30}vw`,
            "--spin": `${(r(4) - 0.5) * 1440}deg`,
            "--fall": `${1.8 + r(5) * 1.6}s`,
            "--delay": `${r(6) * 0.35}s`,
          } as React.CSSProperties,
        };
      }),
    [pieces],
  );
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-20 overflow-hidden motion-reduce:hidden">
      {bits.map((b, i) => (
        <span
          key={i}
          className="reveal-confetti absolute top-0 block rounded-[2px] opacity-0"
          style={{ ...b.style, left: b.left, width: b.size, height: b.size * 0.45, background: b.color }}
        />
      ))}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </svg>
  );
}
