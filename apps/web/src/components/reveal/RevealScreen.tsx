import { auctionSpotsFilled as engineAuctionSpotsFilled, currentLot, remainingBudget } from "@draft-app/engine";
import { useCountdown } from "../../lib/useCountdown";
import type { RevealPayload } from "../../lib/contracts";
import { useDraft } from "../../store/DraftProvider";
import { asEngineState } from "../../store/selectors";

/**
 * "All screens flip at the same moment on lot:reveal" (UI.md) — one shared
 * layout for phone/laptop/board, since the mockups only designed a single
 * Reveal screen. Bid amounts here come ONLY from the `lot:reveal` event
 * payload passed in — never re-derived from a resynced snapshot, since a
 * resolved lot's bids become visible in the snapshot too (by design, once a
 * lot is terminal — see isBidVisible), but the revealTopN truncation the
 * server already applied to this event is what actually governs what's
 * shown here.
 */
export function RevealScreen({ reveal }: { reveal: RevealPayload }) {
  const { snapshot } = useDraft();
  const { label: dismissLabel } = useCountdown(reveal.until, false);

  if (!snapshot) return null;
  const state = asEngineState(snapshot);

  const lot = snapshot.lots.find((l) => l.id === reveal.lotId);
  const player = lot ? snapshot.players.find((p) => p.id === lot.playerId) : undefined;
  const nominator = lot ? snapshot.teams.find((t) => t.id === lot.nominatedByTeamId) : undefined;
  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));

  const totalBidCount = snapshot.bids.filter((b) => b.lotId === reveal.lotId && !b.superseded).length;
  const hiddenCount = Math.max(0, totalBidCount - reveal.bids.length);

  const winner = reveal.winnerTeamId ? teamById.get(reveal.winnerTeamId) : undefined;
  const winnerPrice = lot?.price ?? reveal.bids.find((b) => b.teamId === reveal.winnerTeamId)?.amount ?? null;
  const runnerUps = reveal.bids.filter((b) => b.teamId !== reveal.winnerTeamId);

  // Awarded-to-nominator or returned-to-pool only shows up once the resync
  // lands (the lot:reveal event alone doesn't distinguish them) — until
  // then this quietly says nothing rather than guessing.
  const noBidOutcome =
    reveal.winnerTeamId === null && reveal.bids.length === 0 && lot
      ? lot.state === "awarded"
        ? `No bids — awarded to Team ${nominator?.draftNumber ?? "?"} (the nominator) at the minimum bid.`
        : lot.state === "returnedToPool"
          ? "No bids — returned to the player pool."
          : null
      : null;
  const tied = reveal.winnerTeamId === null && reveal.bids.length > 0;

  const upNext = currentLot(state);
  const upNextPlayer = upNext ? snapshot.players.find((p) => p.id === upNext.playerId) : undefined;
  const upNextNominator = upNext ? snapshot.teams.find((t) => t.id === upNext.nominatedByTeamId) : undefined;

  const winnerAfter = winner ? remainingBudget(state, winner.id) : null;
  const winnerBefore = winnerAfter !== null && winnerPrice !== null ? winnerAfter + winnerPrice : null;
  const winnerSpotsFilled = winner ? engineAuctionSpotsFilled(state, winner.id) : null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-grow flex-col gap-4 py-2">
      <div className="flex justify-between text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
        <span>
          Round {lot?.round ?? "?"} · Lot {lot?.orderInRound ?? "?"}
        </span>
        <span>Bids revealed</span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted">
          {player?.position}
          {player?.nflTeam ? ` · ${player.nflTeam}` : ""}
        </span>
        <span className="font-display text-[40px] font-extrabold uppercase leading-none">{player?.name ?? "—"}</span>
      </div>

      {winner && (
        <div className="flex flex-col gap-2.5 rounded-[18px] bg-accent px-5 py-5 text-on-accent">
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.08em]">
            <TrophyIcon />
            Winner
          </div>
          <div className="flex items-end justify-between">
            <div className="flex flex-col">
              <span className="text-xl font-bold">Team {winner.draftNumber}</span>
              <span className="text-[15px]">{winner.name}</span>
            </div>
            <span className="font-display text-6xl font-extrabold leading-none">${winnerPrice}</span>
          </div>
        </div>
      )}

      {tied && (
        <div className="rounded-panel border-2 border-warn-border bg-warn-bg px-5 py-4 font-semibold text-warn">
          Tied at the top bid — heading to a re-bid round.
        </div>
      )}
      {noBidOutcome && <div className="rounded-panel border border-line bg-surface px-5 py-4 text-muted">{noBidOutcome}</div>}

      {runnerUps.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-[14px] border border-line">
          {runnerUps.map((b, i) => {
            const t = teamById.get(b.teamId);
            const isMe = b.teamId === snapshot.myTeamId;
            return (
              <div key={b.teamId} className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-line" : ""} bg-surface`}>
                <span className="font-display w-7 text-xl font-bold text-muted">{i + 2}</span>
                <span className="flex-grow text-[17px] font-semibold">
                  Team {t?.draftNumber ?? "?"} · {isMe ? "You" : (t?.name ?? "—")}
                </span>
                <span className="font-display text-2xl font-bold">${b.amount}</span>
              </div>
            );
          })}
        </div>
      )}
      {hiddenCount > 0 && (
        <div className="text-sm text-muted">
          {hiddenCount} other bid{hiddenCount === 1 ? "" : "s"} stay{hiddenCount === 1 ? "s" : ""} hidden. The commissioner chooses how many are shown.
        </div>
      )}

      {winner && winnerAfter !== null && winnerBefore !== null && winnerSpotsFilled !== null && (
        <div className="grid grid-cols-2 gap-2">
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

      {upNext && (
        <div className="mt-auto flex items-center justify-between rounded-[14px] border border-line bg-surface px-4 py-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] text-muted">Up next · Lot {upNext.orderInRound}</span>
            <span className="text-[17px] font-semibold">
              {upNextPlayer?.name} · {upNextPlayer?.position} · nominated by Team {upNextNominator?.draftNumber ?? "?"}
            </span>
          </div>
          <span className="font-display text-3xl font-extrabold text-accent">{dismissLabel}</span>
        </div>
      )}
    </div>
  );
}

function TrophyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </svg>
  );
}
