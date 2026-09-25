export type PositionGroup = {
  name: string;
  positions: string[];
  min: number;
  max: number;
};

export type NoBidAction = "awardNominator" | "returnToPool";
export type NominationOrder = "snake" | "fixed";
export type TieFallback =
  | "randomDraw"
  | "commissionerDecides"
  | "higherBudget"
  | "earlierTeamNumber";
export type PickExpiryAction = "autoPick" | "skip";

/** Seconds, or "off" meaning the clock never auto-expires. */
export type ClockSetting = number | "off";

export type DraftSettings = {
  teamCount: number;
  startingBudget: number;
  auctionSpots: number;
  rosterSize: number;
  /** null = position limits off entirely */
  positionGroups: PositionGroup[] | null;
  minBid: number;
  bidStep: number;
  tieMinRaise: number;
  nominatorMustBid: boolean;
  noBidAction: NoBidAction;
  nominationOrder: NominationOrder;
  nominationClockSec: ClockSetting;
  bidClockSec: ClockSetting;
  tieClockSec: ClockSetting;
  pickClockSec: ClockSetting;
  earlyClose: boolean;
  /** null = unlimited tie rebid rounds */
  maxTieRounds: number | null;
  tieFallback: TieFallback;
  revealTopN: number | "all";
  pickExpiryAction: PickExpiryAction;
  brokeTeamsFillAtEnd: boolean;
};
