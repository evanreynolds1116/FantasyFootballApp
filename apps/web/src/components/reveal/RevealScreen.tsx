import { auctionSpotsFilled as engineAuctionSpotsFilled, currentLot, remainingBudget } from "@draft-app/engine";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useCountdown } from "../../lib/useCountdown";
import type { DraftSnapshot, RevealedBid, RevealPayload } from "../../lib/contracts";
import { useDraft } from "../../store/DraftProvider";
import { asEngineState } from "../../store/selectors";
import { fireCue } from "../alerts/cues";
import { CommishNotice } from "../primitives/CommishNotice";
import { PausedBanner } from "../primitives/PausedBanner";
import { PlayerPhoto } from "../primitives/PlayerPhoto";
import { countUpValue, planReveal, SEALED_MS, type RevealPlan } from "./revealTimeline";

/** How long the winner's own "You won!" takeover stays up. */
const YOU_WON_MS = 2400;

/** Milliseconds since the reveal began, ticking while the show plays. */
function useElapsed(startedAt: number, durationMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t - startedAt > durationMs) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [startedAt, durationMs]);
  return now - startedAt;
}

type Team = DraftSnapshot["teams"][number];

/** Everything either layout shows at this moment of the show. */
type RevealView = {
  snapshot: DraftSnapshot;
  plan: RevealPlan;
  elapsed: number;
  lot: DraftSnapshot["lots"][number] | undefined;
  player: DraftSnapshot["players"][number] | undefined;
  teamById: Map<string, Team>;
  teamName: (id: string) => string;
  myTeamId: string | null;
  iWon: boolean;
  cardCount: number;
  hiddenCount: number;
  passes: number;
  topShown: boolean;
  detailsShown: boolean;
  sealedPhase: boolean;
  shaking: "slow" | "fast";
  suspense: boolean;
  faceDown: number;
  ranked: RevealedBid[];
  firstRank: number;
  winner: Team | undefined;
  winnerPrice: number | null;
  shownPrice: number | null;
  margin: number | null;
  noBidOutcome: string | null;
  winnerBefore: number | null;
  winnerAfter: number | null;
  winnerSpotsFilled: number | null;
  upNext: { orderInRound: number; player: string; position: string; nominator: number | string } | null;
  nextClockLabel: string;
  announcement: string;
  sealedCaption: string;
};

/**
 * The show's model, shared by the phone and TV layouts: where the timeline
 * is, what's flipped, the winner's count-up, the details — plus the sounds
 * (draft screen only). Bid amounts come ONLY from the `lot:reveal` message.
 */
function useRevealView(reveal: RevealPayload, withSound: boolean): RevealView | null {
  const { snapshot } = useDraft();
  const { label: nextClockLabel } = useCountdown(reveal.until, false, { ignoreHold: true });
  const plan = useMemo(() => planReveal(reveal.bids, reveal.winnerTeamId), [reveal.bids, reveal.winnerTeamId]);
  const startedAt = reveal.until - plan.durationMs;
  const elapsed = useElapsed(startedAt, plan.durationMs);
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
  const teamName = (id: string) => (id === myTeamId ? "You" : (teamById.get(id)?.name ?? "—"));

  // Every locked-in entry was a face-down card until now: bids and passes look the same before the reveal.
  const entries = snapshot.bids.filter((b) => b.lotId === reveal.lotId && b.tieRound === 0 && !b.superseded).length;
  const cardCount = reveal.afterTie ? reveal.bids.length : Math.max(entries, reveal.bids.length + reveal.passes);
  const hiddenCount = reveal.afterTie ? 0 : Math.max(0, cardCount - reveal.bids.length - reveal.passes);

  const topShown = elapsed >= plan.topAt;
  const flipped = plan.flips.filter((f) => elapsed >= f.at).map((f) => f.bid);
  const winner = reveal.winnerTeamId ? teamById.get(reveal.winnerTeamId) : undefined;
  const winnerPrice = lot?.price ?? plan.top[0]?.amount ?? null;
  const bestRunnerUp = plan.flips.length > 0 ? Math.max(...plan.flips.map((f) => f.bid.amount)) : null;
  const winnerAfter = winner ? remainingBudget(state, winner.id) : null;
  const upNextLot = currentLot(state);
  const upNextPlayer = upNextLot ? snapshot.players.find((p) => p.id === upNextLot.playerId) : undefined;

  const noBidOutcome =
    reveal.bids.length === 0 && lot
      ? lot.state === "awarded"
        ? `No bids — awarded to Team ${nominator?.draftNumber ?? "?"} (the nominator) at the minimum bid.`
        : lot.state === "returnedToPool"
          ? "No bids — back into the player pool."
          : "No bids."
      : null;
  const sealedPhase = elapsed < SEALED_MS;
  const hiddenLine = [
    hiddenCount > 0 ? `${hiddenCount} bid${hiddenCount === 1 ? "" : "s"} stay${hiddenCount === 1 ? "s" : ""} sealed` : "",
    reveal.passes > 0 ? `${reveal.passes} passed` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    snapshot,
    plan,
    elapsed,
    lot,
    player,
    teamById,
    teamName,
    myTeamId,
    iWon,
    cardCount,
    hiddenCount,
    passes: reveal.passes,
    topShown,
    detailsShown: elapsed >= plan.detailsAt,
    sealedPhase,
    shaking: sealedPhase && elapsed > SEALED_MS - 800 ? "fast" : "slow",
    suspense: plan.suspenseAt !== null && elapsed >= plan.suspenseAt && !topShown,
    faceDown: Math.max(0, cardCount - flipped.length - (topShown ? plan.top.length : 0)),
    // Runner-ups as they flip, shown ranked (best first) under the top card.
    ranked: [...flipped].sort((a, b) => b.amount - a.amount),
    firstRank: plan.top.length + 1,
    winner,
    winnerPrice,
    shownPrice: winnerPrice !== null ? countUpValue(bestRunnerUp ?? 0, winnerPrice, elapsed - plan.topAt) : null,
    margin: bestRunnerUp !== null && winnerPrice !== null && elapsed - plan.topAt > 900 ? winnerPrice - bestRunnerUp : null,
    noBidOutcome,
    winnerBefore: winnerAfter !== null && winnerPrice !== null ? winnerAfter + winnerPrice : null,
    winnerAfter,
    winnerSpotsFilled: winner ? engineAuctionSpotsFilled(state, winner.id) : null,
    upNext:
      upNextLot && upNextLot.id !== reveal.lotId
        ? {
            orderInRound: upNextLot.orderInRound,
            player: upNextPlayer?.name ?? "—",
            position: upNextPlayer?.position ?? "",
            nominator: snapshot.teams.find((t) => t.id === upNextLot.nominatedByTeamId)?.draftNumber ?? "?",
          }
        : null,
    nextClockLabel,
    announcement: !topShown
      ? ""
      : plan.tie
        ? `It's a tie at $${plan.top[0]?.amount} between ${plan.top.map((b) => `Team ${teamById.get(b.teamId)?.draftNumber ?? "?"}`).join(" and ")}.`
        : winner
          ? `Team ${winner.draftNumber} wins ${player?.name ?? "the player"} for $${winnerPrice}.`
          : (noBidOutcome ?? ""),
    sealedCaption: topShown ? hiddenLine : sealedPhase ? `${cardCount} sealed ${cardCount === 1 ? "entry" : "entries"} · revealing…` : "",
  };
}

/**
 * The reveal as a short show (UI.md §3): sealed cards shake to a drumroll,
 * runner-ups flip lowest first, "And the winner is…", then the winner's card
 * slams down with the price counting up — or "It's a tie!". Every screen
 * plays it from the same `lot:reveal` message, and the server holds the next
 * clock until it's over. Bids the reveal setting hides stay face-down cards,
 * counted but never shown. `size="board"` is the TV layout for the big board.
 */
export function RevealScreen({ reveal, withSound = false, size = "phone" }: { reveal: RevealPayload; withSound?: boolean; size?: "phone" | "board" }) {
  const view = useRevealView(reveal, withSound);
  if (!view) return null;
  return size === "board" ? <BoardReveal v={view} /> : <PhoneReveal v={view} />;
}

function PhoneReveal({ v }: { v: RevealView }) {
  const { plan, snapshot } = v;
  return (
    <div className="relative mx-auto flex w-full max-w-xl flex-grow flex-col gap-4 py-2">
      <div className="flex justify-between text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
        <span>
          Round {v.lot?.round ?? "?"} · Lot {v.lot?.orderInRound ?? "?"}
        </span>
        <span>{v.topShown ? "Bids revealed" : "Bidding closed"}</span>
      </div>

      <div className="flex items-center gap-3">
        {v.player && <PlayerPhoto player={v.player} size={64} />}
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm text-muted">
            {v.player?.position}
            {v.player?.nflTeam ? ` · ${v.player.nflTeam}` : ""}
          </span>
          <span className="font-display text-[40px] font-extrabold uppercase leading-none">{v.player?.name ?? "—"}</span>
        </div>
      </div>

      {v.faceDown > 0 && (
        <div className="flex flex-col gap-2">
          <SealedCards v={v} size="phone" />
          {v.sealedCaption && <span className="text-sm text-muted">{v.sealedCaption}</span>}
        </div>
      )}

      {v.suspense && <div className="reveal-pulse py-3 text-center font-display text-3xl font-extrabold uppercase text-accent">And the winner is…</div>}

      {v.topShown && v.winner && (
        <div className={`reveal-slam flex flex-col gap-2.5 rounded-[18px] bg-accent px-5 py-5 text-on-accent ${v.iWon ? "ring-4 ring-text" : ""}`}>
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.08em]">
            <TrophyIcon size={20} />
            {v.iWon ? "You won!" : "Winner"}
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xl font-bold">Team {v.winner.draftNumber}</span>
              <span className="text-[15px]">{v.winner.name}</span>
            </div>
            <span className="font-display text-6xl font-extrabold leading-none tabular-nums">${v.shownPrice}</span>
          </div>
          {v.margin !== null && <span className="reveal-fade-up text-sm font-bold">won by ${v.margin}</span>}
        </div>
      )}

      {v.topShown && plan.tie && (
        <div className="reveal-slam flex flex-col gap-2 rounded-[18px] border-2 border-warn-border bg-warn-bg px-5 py-4 text-warn">
          <span className="font-display text-4xl font-extrabold uppercase">It&apos;s a tie!</span>
          {plan.top.map((b) => (
            <div key={b.teamId} className="flex items-center justify-between text-[17px] font-semibold text-text">
              <span>
                Team {v.teamById.get(b.teamId)?.draftNumber ?? "?"} · {v.teamName(b.teamId)}
              </span>
              <span className="font-display text-2xl font-bold">${b.amount}</span>
            </div>
          ))}
          <span className="text-sm font-semibold">{plan.top.some((b) => b.teamId === v.myTeamId) ? "You're in the re-bid round next." : "The tied teams re-bid next."}</span>
        </div>
      )}

      {v.topShown && v.noBidOutcome && <div className="reveal-fade-up rounded-panel border border-line bg-surface px-5 py-4 text-muted">{v.noBidOutcome}</div>}

      {v.ranked.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-[14px] border border-line">
          {v.ranked.map((b, i) => (
            <div key={b.teamId} className={`reveal-flip flex items-center gap-3 bg-surface px-4 py-3.5 ${i > 0 ? "border-t border-line" : ""}`}>
              <span className="font-display w-7 text-xl font-bold text-muted">{v.firstRank + i}</span>
              <span className="flex-grow text-[17px] font-semibold">
                Team {v.teamById.get(b.teamId)?.draftNumber ?? "?"} · {v.teamName(b.teamId)}
              </span>
              <span className="font-display text-2xl font-bold">${b.amount}</span>
            </div>
          ))}
        </div>
      )}

      {v.detailsShown && v.winner && v.winnerAfter !== null && v.winnerBefore !== null && v.winnerSpotsFilled !== null && (
        <div className="reveal-fade-up grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-surface px-3 py-2.5">
            <div className="text-xs text-muted">Team {v.winner.draftNumber} budget</div>
            <div className="font-display text-xl font-bold">
              ${v.winnerBefore} → ${v.winnerAfter}
            </div>
          </div>
          <div className="rounded-xl bg-surface px-3 py-2.5">
            <div className="text-xs text-muted">Team {v.winner.draftNumber} auction spots</div>
            <div className="font-display text-xl font-bold">
              {v.winnerSpotsFilled} / {snapshot.settings.auctionSpots}
            </div>
          </div>
        </div>
      )}

      {v.detailsShown && v.upNext && (
        <div className="reveal-fade-up mt-auto flex items-center justify-between rounded-[14px] border border-line bg-surface px-4 py-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-muted">Up next · Lot {v.upNext.orderInRound} · clock starts in</span>
            <span className="text-[17px] font-semibold">
              {v.upNext.player} · {v.upNext.position} · nominated by Team {v.upNext.nominator}
            </span>
          </div>
          <span className="font-display text-3xl font-extrabold text-accent">{v.nextClockLabel}</span>
        </div>
      )}

      <Announcement text={v.announcement} />
      {v.topShown && v.winner && v.elapsed - plan.topAt < 4000 && <Confetti pieces={v.iWon ? 90 : 36} />}
      {v.topShown && v.iWon && v.elapsed - plan.topAt < YOU_WON_MS && (
        <div aria-hidden="true" className="reveal-flash pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-accent/95 text-on-accent">
          <span className="font-display text-7xl font-extrabold uppercase">You won!</span>
          <span className="text-2xl font-bold">
            {v.player?.name} · ${v.winnerPrice}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The same show sized for a TV across a room (UI.md §7): the player and the
 * big moment on the left, the flipped bids and what's next on the right.
 */
function BoardReveal({ v }: { v: RevealView }) {
  const { plan, snapshot } = v;
  return (
    <div className="relative flex h-screen w-screen flex-col gap-6 bg-bg px-12 py-8 text-text">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[34px] font-extrabold uppercase tracking-[0.02em]">Draft Day</span>
        <span className="text-[22px] font-semibold uppercase tracking-[0.06em] text-muted">
          Round {v.lot?.round ?? "?"} · Lot {v.lot?.orderInRound ?? "?"} · {v.topShown ? "Bids revealed" : "Bidding closed"}
        </span>
      </div>
      <PausedBanner paused={snapshot.paused} breakEndsAt={snapshot.breakEndsAt} />
      <CommishNotice size="board" />

      <div className="flex min-h-0 flex-grow gap-10">
        <div className="flex min-w-0 flex-grow flex-col gap-7">
          <div className="flex items-center gap-7">
            {v.player && <PlayerPhoto player={v.player} size={176} />}
            <div className="flex min-w-0 flex-col gap-3">
              <span className="self-start rounded-lg bg-chip px-3 py-1 text-xl font-bold tracking-[0.08em] text-accent">
                {v.player?.position}
                {v.player?.nflTeam ? ` · ${v.player.nflTeam}` : ""}
              </span>
              <span className="font-display text-[96px] font-extrabold uppercase leading-[0.9]">{v.player?.name ?? "—"}</span>
            </div>
          </div>

          {v.faceDown > 0 && (
            <div className="flex flex-col gap-3">
              <SealedCards v={v} size="board" />
              {v.sealedCaption && <span className="text-2xl text-muted">{v.sealedCaption}</span>}
            </div>
          )}

          {v.suspense && <div className="reveal-pulse font-display text-[88px] font-extrabold uppercase leading-none text-accent">And the winner is…</div>}

          {v.topShown && v.winner && (
            <div className="reveal-slam flex items-center justify-between gap-8 rounded-[28px] bg-accent px-10 py-8 text-on-accent">
              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-3 text-2xl font-bold uppercase tracking-[0.08em]">
                  <TrophyIcon size={32} />
                  Winner
                </span>
                <span className="font-display text-[64px] font-extrabold uppercase leading-none">Team {v.winner.draftNumber}</span>
                <span className="text-[30px] font-semibold">{v.winner.name}</span>
                {v.margin !== null && <span className="reveal-fade-up text-2xl font-bold">won by ${v.margin}</span>}
              </div>
              <span className="font-display text-[168px] font-extrabold leading-[0.85] tabular-nums">${v.shownPrice}</span>
            </div>
          )}

          {v.topShown && plan.tie && (
            <div className="reveal-slam flex flex-col gap-4 rounded-[28px] border-4 border-warn-border bg-warn-bg px-10 py-8 text-warn">
              <span className="font-display text-[112px] font-extrabold uppercase leading-none">It&apos;s a tie!</span>
              <div className="flex flex-wrap gap-x-12 gap-y-2">
                {plan.top.map((b) => (
                  <span key={b.teamId} className="text-[40px] font-bold text-text">
                    Team {v.teamById.get(b.teamId)?.draftNumber ?? "?"} <span className="font-display">${b.amount}</span>
                  </span>
                ))}
              </div>
              <span className="text-2xl font-semibold">The tied teams re-bid next.</span>
            </div>
          )}

          {v.topShown && v.noBidOutcome && <div className="reveal-fade-up rounded-[24px] border border-line bg-surface px-9 py-7 text-[34px] text-muted">{v.noBidOutcome}</div>}
        </div>

        <div className="flex w-[34%] min-w-[420px] flex-shrink-0 flex-col gap-5">
          <span className="text-xl font-bold uppercase tracking-[0.08em] text-muted">Revealed bids</span>
          {v.ranked.length === 0 && !v.topShown && <span className="text-2xl text-muted">Flipping soon…</span>}
          {v.ranked.length === 0 && v.topShown && <span className="text-2xl text-muted">No other bids shown.</span>}
          {v.ranked.length > 0 && (
            <div className="flex flex-col overflow-hidden rounded-[20px] border border-line">
              {v.ranked.map((b, i) => (
                <div key={b.teamId} className={`reveal-flip flex items-center gap-4 bg-surface px-6 py-4 ${i > 0 ? "border-t border-line" : ""}`}>
                  <span className="font-display w-10 text-[34px] font-bold text-muted">{v.firstRank + i}</span>
                  <span className="min-w-0 flex-grow truncate text-[26px] font-semibold">
                    Team {v.teamById.get(b.teamId)?.draftNumber ?? "?"} · {v.teamName(b.teamId)}
                  </span>
                  <span className="font-display text-[44px] font-bold">${b.amount}</span>
                </div>
              ))}
            </div>
          )}

          {v.detailsShown && v.winner && v.winnerAfter !== null && v.winnerBefore !== null && v.winnerSpotsFilled !== null && (
            <div className="reveal-fade-up grid grid-cols-2 gap-3">
              <div className="rounded-[18px] bg-surface px-5 py-4">
                <div className="text-lg text-muted">Team {v.winner.draftNumber} budget</div>
                <div className="font-display text-[40px] font-bold leading-tight">
                  ${v.winnerBefore} → ${v.winnerAfter}
                </div>
              </div>
              <div className="rounded-[18px] bg-surface px-5 py-4">
                <div className="text-lg text-muted">Auction spots</div>
                <div className="font-display text-[40px] font-bold leading-tight">
                  {v.winnerSpotsFilled} / {snapshot.settings.auctionSpots}
                </div>
              </div>
            </div>
          )}

          {v.detailsShown && v.upNext && (
            <div className="reveal-fade-up mt-auto flex items-center justify-between gap-4 rounded-[20px] border border-line bg-surface px-6 py-5">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-lg text-muted">Up next · Lot {v.upNext.orderInRound} · clock starts in</span>
                <span className="truncate text-[28px] font-semibold">
                  {v.upNext.player} · {v.upNext.position}
                </span>
                <span className="text-lg text-muted">nominated by Team {v.upNext.nominator}</span>
              </div>
              <span className="font-display text-[72px] font-extrabold leading-none text-accent">{v.nextClockLabel}</span>
            </div>
          )}
        </div>
      </div>

      <Announcement text={v.announcement} />
      {v.topShown && v.winner && v.elapsed - plan.topAt < 4500 && <Confetti pieces={140} scale={2} />}
    </div>
  );
}

function SealedCards({ v, size }: { v: RevealView; size: "phone" | "board" }) {
  const board = size === "board";
  return (
    <div className={`flex flex-wrap ${board ? "gap-3" : "gap-1.5"}`} aria-hidden="true">
      {Array.from({ length: v.faceDown }, (_, i) => (
        <div
          key={i}
          className={`flex items-center justify-center border-2 font-display font-extrabold ${board ? "h-[112px] w-20 rounded-2xl border-[3px] text-6xl" : "h-14 w-10 rounded-lg text-2xl"} ${
            v.topShown ? "border-line bg-surface text-muted opacity-60" : `border-accent bg-chip text-accent ${v.shaking === "fast" ? "reveal-shake-fast" : "reveal-shake"}`
          }`}
          style={{ animationDelay: `${(i * 37) % 140}ms` }}
        >
          {v.topShown ? <LockIcon size={board ? 36 : 18} /> : "?"}
        </div>
      ))}
    </div>
  );
}

function Announcement({ text }: { text: string }) {
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {text}
    </div>
  );
}

const CONFETTI_COLORS = ["#F2B84B", "#8FD6A8", "#EEF2EC", "#FF9A7A", "#F7D58B"];

/** A burst of falling confetti (skipped entirely for anyone who prefers reduced motion). */
function Confetti({ pieces, scale = 1 }: { pieces: number; scale?: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => {
        // Deterministic scatter from the index, so re-renders don't reshuffle it.
        const r = (n: number) => (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1;
        return {
          left: `${r(1) * 100}%`,
          size: (6 + r(2) * 7) * scale,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
          style: {
            "--drift": `${(r(3) - 0.5) * 30}vw`,
            "--spin": `${(r(4) - 0.5) * 1440}deg`,
            "--fall": `${1.8 + r(5) * 1.6}s`,
            "--delay": `${r(6) * 0.35}s`,
          } as CSSProperties,
        };
      }),
    [pieces, scale],
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

function LockIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function TrophyIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </svg>
  );
}
