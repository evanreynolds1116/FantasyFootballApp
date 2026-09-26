import type { Lot, Player, Team } from "@draft-app/engine";
import type { Socket } from "socket.io-client";
import { CountdownRing } from "../primitives/CountdownRing";
import { PlayerCard } from "../primitives/PlayerCard";
import { StatTile } from "../primitives/StatTile";
import { BidStatusStrip } from "../primitives/BidStatusStrip";
import { BidAmountFieldPhone } from "./BidAmountFieldPhone";
import { SubmittedBidPanel } from "./SubmittedBidPanel";
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
  round: number;
  totalLotsInRound: number;
  spotsFilled: number;
  spotsTotal: number;
  positionLabel: string;
  positionCount: number;
  positionMax: number | null;
};

export function BidScreenPhone(props: Props) {
  const { lot, player, nominatedByLabel, teams, hasBidTeamIds, eligibleTeamIds, totalSeconds, paused, minBid, budget, disabled, disabledReason, socket } = props;
  const form = useBidForm({ socket, lotId: lot.id, minBid, budget, hasServerBid: props.myHasBid });

  return (
    <div className="flex h-full flex-col gap-3.5 px-4 pb-4 pt-5">
      <div className="flex items-center justify-between text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
        <span>
          Round {props.round} · Lot {lot.orderInRound} of {props.totalLotsInRound}
        </span>
        <span>{nominatedByLabel}</span>
      </div>

      <div className="flex items-center gap-4 rounded-panel border border-line bg-surface p-4">
        <CountdownRing endsAt={lot.endsAt} paused={paused} totalSeconds={totalSeconds} sizePx={96} label="Time left to bid" />
        <PlayerCard player={player} nominatedByLabel={nominatedByLabel} size="phone" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Budget left" value={`$${budget}`} />
        <StatTile label="Auction spots" value={`${props.spotsFilled} / ${props.spotsTotal}`} />
        <StatTile label={props.positionLabel} value={props.positionMax !== null ? `${props.positionCount} / ${props.positionMax}` : `${props.positionCount}`} />
      </div>

      {form.isSubmitted ? (
        <SubmittedBidPanel amount={form.submittedAmount} onChange={form.change} size="phone" />
      ) : (
        <BidAmountFieldPhone form={form} minBid={minBid} budget={budget} disabled={disabled} disabledReason={disabledReason} />
      )}

      <div className="mt-auto">
        <BidStatusStrip teams={teams} hasBidTeamIds={hasBidTeamIds} eligibleTeamIds={eligibleTeamIds} size="phone" />
      </div>
    </div>
  );
}
