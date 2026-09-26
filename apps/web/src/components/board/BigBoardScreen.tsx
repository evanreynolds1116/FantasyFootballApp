import {
  currentLot,
  isBroke,
  lotsInRound,
  nominationOrderForRound,
  remainingBudget,
  teamsByDraftNumber,
  auctionSpotsFilled as engineAuctionSpotsFilled,
} from "@draft-app/engine";
import type { ReactNode } from "react";
import { useDraft } from "../../store/DraftProvider";
import { asEngineState } from "../../store/selectors";
import { useCountdown } from "../../lib/useCountdown";
import { RevealScreen } from "../reveal/RevealScreen";
import { SnakeBoardGrid } from "../snake/SnakeBoardGrid";
import { TieRebidScreen } from "../tie/TieRebidScreen";
import { BidStatusStrip } from "../primitives/BidStatusStrip";
import { PausedBanner } from "../primitives/PausedBanner";
import { RoundLotsGrid } from "./RoundLotsGrid";
import { TeamsOverviewBoard, type BoardTeamRow } from "./TeamsOverviewBoard";

export function BigBoardScreen() {
  const { snapshot, reveal } = useDraft();
  if (!snapshot) return <div className="flex h-full items-center justify-center text-muted">Loading…</div>;

  if (reveal) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg px-12 py-8">
        <RevealScreen reveal={reveal} />
      </div>
    );
  }

  if (snapshot.phase === "snake") {
    const clockTeam = snapshot.teams.find((t) => t.id === snapshot.snakePickTurnTeamId);
    const totalRounds = snapshot.settings.rosterSize - snapshot.settings.auctionSpots;
    return (
      <BoardShell phase={snapshot.phase} round={snapshot.snakeRound} lotIndex={null} lotsCount={null} paused={snapshot.paused} breakEndsAt={snapshot.breakEndsAt}>
        <div className="flex min-w-0 flex-grow flex-col gap-5">
          <div className="rounded-[24px] border border-line bg-surface px-9 py-6 text-2xl">
            <span className="font-bold text-accent">Team {clockTeam?.draftNumber ?? "?"}</span> is on the clock
          </div>
          <SnakeBoardGrid
            totalRounds={totalRounds}
            teams={snapshot.teams}
            players={snapshot.players}
            picks={snapshot.picks}
            currentRound={snapshot.snakeRound}
            currentTeamId={snapshot.snakePickTurnTeamId}
          />
        </div>
      </BoardShell>
    );
  }

  if (snapshot.phase !== "auction") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
        <span className="font-display text-3xl font-extrabold uppercase text-text">{snapshot.phase}</span>
        <span>This board view isn&apos;t built yet for this phase.</span>
      </div>
    );
  }

  const state = asEngineState(snapshot);
  const lot = currentLot(state);
  const teamRows: BoardTeamRow[] = snapshot.teams.map((t) => ({
    id: t.id,
    draftNumber: t.draftNumber,
    name: t.name,
    moneyLeft: remainingBudget(state, t.id),
    spotsFilled: engineAuctionSpotsFilled(state, t.id),
    spotsTotal: snapshot.settings.auctionSpots,
    broke: isBroke(state, t.id),
  }));

  if (lot?.state === "tieRebid") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg px-12 py-8">
        <TieRebidScreen lot={lot} />
      </div>
    );
  }

  if (snapshot.nominationTurnTeamId !== null) {
    const nominator = snapshot.teams.find((t) => t.id === snapshot.nominationTurnTeamId);
    return (
      <BoardShell phase={snapshot.phase} round={snapshot.auctionRound} lotIndex={null} lotsCount={null} paused={snapshot.paused} breakEndsAt={snapshot.breakEndsAt}>
        <div className="flex flex-grow items-center justify-center text-3xl text-muted">
          Team {nominator?.draftNumber ?? "?"} is nominating…
        </div>
        <TeamsOverviewBoard rows={teamRows} />
      </BoardShell>
    );
  }

  if (!lot || lot.state === "queued") {
    return (
      <BoardShell phase={snapshot.phase} round={snapshot.auctionRound} lotIndex={null} lotsCount={null} paused={snapshot.paused} breakEndsAt={snapshot.breakEndsAt}>
        <div className="flex flex-grow items-center justify-center text-3xl text-muted">Waiting for the next lot…</div>
        <TeamsOverviewBoard rows={teamRows} />
      </BoardShell>
    );
  }

  const player = snapshot.players.find((p) => p.id === lot.playerId);
  const nominator = snapshot.teams.find((t) => t.id === lot.nominatedByTeamId);
  const roundLots = lotsInRound(state, lot.round);
  const hasBidTeamIds = new Set(snapshot.bids.filter((b) => b.lotId === lot.id && !b.superseded).map((b) => b.teamId));
  const eligibleTeamIds = new Set(lot.eligibleTeamIds);

  const baseIds = teamsByDraftNumber(snapshot.teams);
  const nextRoundOrder = nominationOrderForRound(snapshot.settings, baseIds, lot.round + 1);
  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));
  const nextRoundDirection =
    nextRoundOrder.length > 1
      ? (`${teamById.get(nextRoundOrder[0]!)?.draftNumber} → ${teamById.get(nextRoundOrder[nextRoundOrder.length - 1]!)?.draftNumber}` as const)
      : null;

  return (
    <BoardShell
      phase={snapshot.phase}
      round={lot.round}
      lotIndex={lot.orderInRound}
      lotsCount={roundLots.length}
      paused={snapshot.paused}
      breakEndsAt={snapshot.breakEndsAt}
    >
      <div className="flex min-w-0 flex-grow flex-col gap-5">
        <LiveLotHero
          positionAndTeam={player ? `${player.position}${player.nflTeam ? ` · ${player.nflTeam}` : ""}` : ""}
          name={player?.name ?? "—"}
          nominatorLabel={`Nominated by Team ${nominator?.draftNumber ?? "?"}`}
          endsAt={lot.endsAt}
          paused={snapshot.paused}
        />

        <BidStatusStrip teams={snapshot.teams} hasBidTeamIds={hasBidTeamIds} eligibleTeamIds={eligibleTeamIds} size="board" />

        <RoundLotsGrid
          round={lot.round}
          lotsInRound={roundLots}
          players={snapshot.players}
          teams={snapshot.teams}
          currentLotId={lot.id}
          paused={snapshot.paused}
          nextRoundDirection={nextRoundDirection as "1 → 12" | "12 → 1" | null}
        />
      </div>

      <TeamsOverviewBoard rows={teamRows} />
    </BoardShell>
  );
}

function LiveLotHero({
  positionAndTeam,
  name,
  nominatorLabel,
  endsAt,
  paused,
}: {
  positionAndTeam: string;
  name: string;
  nominatorLabel: string;
  endsAt: number | null;
  paused: boolean;
}) {
  const { label, danger } = useCountdown(endsAt, paused);
  return (
    <div className="flex items-center gap-9 rounded-[24px] border border-line bg-surface px-9 py-6">
      <div className="flex flex-grow flex-col gap-2">
        <span className="self-start rounded-lg bg-chip px-3 py-1 text-lg font-bold tracking-[0.08em] text-accent">{positionAndTeam}</span>
        <span className="font-display text-[84px] font-extrabold uppercase leading-[0.9]">{name}</span>
        <span className="text-xl text-muted">{nominatorLabel} · Sealed bids close when the clock hits zero</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className={`font-display text-[124px] font-extrabold leading-[0.85] ${danger ? "text-warn" : "text-accent"}`}>{label}</span>
        <span className="text-base uppercase tracking-[0.08em] text-muted">left to bid</span>
      </div>
    </div>
  );
}

function BoardShell({
  phase,
  round,
  lotIndex,
  lotsCount,
  paused,
  breakEndsAt,
  children,
}: {
  phase: string;
  round: number;
  lotIndex: number | null;
  lotsCount: number | null;
  paused: boolean;
  breakEndsAt: number | null;
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen w-screen flex-col gap-5 bg-bg px-12 py-8 text-text">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[34px] font-extrabold uppercase tracking-[0.02em]">Draft Day</span>
        <span className="text-[22px] font-semibold uppercase tracking-[0.06em] text-muted">
          {phase} · Round {round}
          {lotIndex !== null && lotsCount !== null ? ` · Lot ${lotIndex} of ${lotsCount}` : ""}
        </span>
      </div>
      <PausedBanner paused={paused} breakEndsAt={breakEndsAt} />
      <div className="flex min-h-0 flex-grow gap-8">{children}</div>
    </div>
  );
}
