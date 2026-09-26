import type { Lot, Pick as EnginePick, Player, PositionGroup, Team } from "@draft-app/engine";
import type { Socket } from "socket.io-client";
import { CountdownRing } from "../primitives/CountdownRing";
import { PlayerCard } from "../primitives/PlayerCard";
import { BidStatusStrip } from "../primitives/BidStatusStrip";
import { AllTeamsPanel, type TeamRow } from "./AllTeamsPanel";
import { BidAmountFieldLaptop } from "./BidAmountFieldLaptop";
import { RoundLotsList } from "./RoundLotsList";
import { SubmittedBidPanel } from "./SubmittedBidPanel";
import { TeamRosterPanel } from "./TeamRosterPanel";
import { useBidForm } from "./useBidForm";

type Props = {
  lot: Lot;
  player: Player;
  nominatedByLabel: string;
  teams: Team[];
  hasBidTeamIds: Set<string>;
  eligibleTeamIds: Set<string>;
  totalSeconds: number | null;
  paused: boolean;
  minBid: number;
  budget: number;
  disabled: boolean;
  disabledReason?: string;
  socket: Socket;
  myHasBid: boolean;
  lotsInRound: Lot[];
  players: Player[];
  teamRows: TeamRow[];
  positionLabel: string;
  myPicks: EnginePick[];
  positionGroups: PositionGroup[] | null;
  auctionSpotsFilled: number;
  auctionSpots: number;
  spent: number;
  liveGroup: PositionGroup | undefined;
  positionGroupCountForLive: number | null;
};

export function BidScreenLaptop(props: Props) {
  const { lot, player, nominatedByLabel, teams, hasBidTeamIds, eligibleTeamIds, totalSeconds, paused, minBid, budget, disabled, disabledReason, socket } = props;
  const form = useBidForm({ socket, lotId: lot.id, minBid, budget, hasServerBid: props.myHasBid });

  return (
    <div className="flex-grow flex gap-6 min-h-0">
      <RoundLotsList round={lot.round} lotsInRound={props.lotsInRound} players={props.players} teams={teams} currentLotId={lot.id} />

      <div className="flex min-w-0 flex-grow flex-col gap-[18px]">
        <div className="flex items-center gap-7 rounded-[20px] border border-line bg-surface px-8 py-7">
          <PlayerCard player={player} nominatedByLabel={nominatedByLabel} size="laptop" />
          <CountdownRing endsAt={lot.endsAt} paused={paused} totalSeconds={totalSeconds} sizePx={132} label="Time left to bid" />
        </div>

        {form.isSubmitted ? (
          <SubmittedBidPanel amount={form.submittedAmount} lockedIn={form.lockedIn} onChange={form.change} size="laptop" />
        ) : (
          <BidAmountFieldLaptop form={form} minBid={minBid} budget={budget} disabled={disabled} disabledReason={disabledReason} />
        )}

        <div className="rounded-[20px] border border-line bg-surface px-7 py-5">
          <BidStatusStrip teams={teams} hasBidTeamIds={hasBidTeamIds} eligibleTeamIds={eligibleTeamIds} size="laptop" />
        </div>

        <TeamRosterPanel
          picks={props.myPicks}
          players={props.players}
          positionGroups={props.positionGroups}
          auctionSpotsFilled={props.auctionSpotsFilled}
          auctionSpots={props.auctionSpots}
          spent={props.spent}
          liveGroup={props.liveGroup}
          positionGroupCountForLive={props.positionGroupCountForLive}
        />
      </div>

      <AllTeamsPanel rows={props.teamRows} positionLabel={props.positionLabel} />
    </div>
  );
}
