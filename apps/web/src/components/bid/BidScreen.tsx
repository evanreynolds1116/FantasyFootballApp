import {
  auctionSpotsRemaining,
  canBidOnPlayer,
  currentLot,
  isBroke,
  lotsInRound,
  positionGroupCount,
  positionGroupFor,
  remainingBudget,
  spentByTeam,
  wouldExceedPositionMax,
  auctionSpotsFilled as engineAuctionSpotsFilled,
} from "@draft-app/engine";
import { useDraft } from "../../store/DraftProvider";
import { asEngineState } from "../../store/selectors";
import { useIsLaptop } from "../../lib/useMediaQuery";
import type { TeamRow } from "./AllTeamsPanel";
import { BidScreenLaptop } from "./BidScreenLaptop";
import { BidScreenPhone } from "./BidScreenPhone";

export function BidScreen() {
  const { snapshot, socket } = useDraft();
  const isLaptop = useIsLaptop();

  if (!snapshot || snapshot.phase !== "auction") return null;

  const state = asEngineState(snapshot);
  const lot = currentLot(state);
  if (!lot || lot.state === "queued") {
    return (
      <div className="flex flex-grow items-center justify-center text-muted">Waiting for the next lot…</div>
    );
  }

  const player = snapshot.players.find((p) => p.id === lot.playerId);
  if (!player) return null;

  const nominator = snapshot.teams.find((t) => t.id === lot.nominatedByTeamId);
  const myTeamId = snapshot.myTeamId;
  const eligibleTeamIds = new Set(lot.eligibleTeamIds);
  const hasBidTeamIds = new Set(snapshot.bids.filter((b) => b.lotId === lot.id && !b.superseded).map((b) => b.teamId));

  const group = positionGroupFor(snapshot.settings.positionGroups, player.position);
  const totalSeconds = typeof snapshot.settings.bidClockSec === "number" ? snapshot.settings.bidClockSec : null;

  const iAmEligible = myTeamId !== null && eligibleTeamIds.has(myTeamId);
  let disabledReason: string | undefined;
  if (myTeamId === null) {
    disabledReason = "You're a spectator on this draft.";
  } else if (!iAmEligible) {
    if (auctionSpotsRemaining(state, myTeamId) <= 0) disabledReason = "All your auction spots are filled.";
    else if (isBroke(state, myTeamId)) disabledReason = "You don't have enough budget left to bid.";
    else if (wouldExceedPositionMax(state, myTeamId, player.position)) disabledReason = `You're already at your ${group?.name ?? player.position} max.`;
    else disabledReason = "You're not eligible to bid on this lot.";
  }

  const disabled = snapshot.paused || !iAmEligible || myTeamId === null;

  const common = {
    lot,
    player,
    nominatedByLabel: `Nominated by Team ${nominator?.draftNumber ?? "?"}`,
    teams: snapshot.teams,
    hasBidTeamIds,
    eligibleTeamIds,
    totalSeconds,
    paused: snapshot.paused,
    minBid: snapshot.settings.minBid,
    budget: myTeamId ? remainingBudget(state, myTeamId) : 0,
    disabled,
    disabledReason,
    socket,
    myHasBid: myTeamId !== null && hasBidTeamIds.has(myTeamId),
  };

  if (!isLaptop) {
    const spotsFilled = myTeamId ? engineAuctionSpotsFilled(state, myTeamId) : 0;
    const positionCount = myTeamId && group ? positionGroupCount(state, myTeamId, group) : 0;
    return (
      <BidScreenPhone
        {...common}
        round={lot.round}
        totalLotsInRound={lotsInRound(state, lot.round).length}
        spotsFilled={spotsFilled}
        spotsTotal={snapshot.settings.auctionSpots}
        positionLabel={`Your ${group?.name ?? player.position}`}
        positionCount={positionCount}
        positionMax={group?.max ?? null}
      />
    );
  }

  const teamRows: TeamRow[] = snapshot.teams.map((t) => {
    const g = positionGroupFor(snapshot.settings.positionGroups, player.position);
    return {
      id: t.id,
      draftNumber: t.draftNumber,
      name: t.name,
      maxBid: remainingBudget(state, t.id),
      spotsFilled: engineAuctionSpotsFilled(state, t.id),
      spotsTotal: snapshot.settings.auctionSpots,
      positionCount: g ? positionGroupCount(state, t.id, g) : 0,
      eligible: canBidOnPlayer(state, t.id, player.id),
      broke: isBroke(state, t.id),
      isMe: t.id === myTeamId,
    };
  });

  const myPicks = myTeamId ? state.picks.filter((p) => p.teamId === myTeamId) : [];

  return (
    <BidScreenLaptop
      {...common}
      lotsInRound={lotsInRound(state, lot.round)}
      players={snapshot.players}
      teamRows={teamRows}
      positionLabel={group?.name ?? player.position}
      myPicks={myPicks}
      positionGroups={snapshot.settings.positionGroups}
      auctionSpotsFilled={myTeamId ? engineAuctionSpotsFilled(state, myTeamId) : 0}
      auctionSpots={snapshot.settings.auctionSpots}
      spent={myTeamId ? spentByTeam(state, myTeamId) : 0}
      liveGroup={group}
      positionGroupCountForLive={myTeamId && group ? positionGroupCount(state, myTeamId, group) : null}
    />
  );
}
