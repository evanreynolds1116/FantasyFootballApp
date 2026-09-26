import type { Bid, DraftSettings, Lot, Pick, Player, PositionGroup, Team } from "@draft-app/engine";
import type * as schema from "./schema.js";

type DraftSettingsRow = typeof schema.draftSettings.$inferSelect;
type TeamRow = typeof schema.team.$inferSelect;
type PlayerRow = typeof schema.player.$inferSelect;
type LotRow = typeof schema.lot.$inferSelect;
type BidRow = typeof schema.bid.$inferSelect;
type PickRow = typeof schema.pick.$inferSelect;

export function settingsFromRow(row: DraftSettingsRow): DraftSettings {
  return {
    teamCount: row.teamCount,
    startingBudget: row.budget,
    auctionSpots: row.auctionSpots,
    rosterSize: row.rosterSize,
    positionGroups: (row.positionGroups as PositionGroup[] | null) ?? null,
    minBid: row.minBid,
    bidStep: row.bidStep,
    tieMinRaise: row.tieMinRaise,
    noBidAction: row.noBidAction,
    nominationOrder: row.nominationOrder,
    nominationClockSec: row.nominationClockSec ?? "off",
    bidClockSec: row.bidClockSec ?? "off",
    tieClockSec: row.tieClockSec ?? "off",
    pickClockSec: row.pickClockSec ?? "off",
    earlyClose: row.earlyClose,
    maxTieRounds: row.maxTieRounds,
    tieFallback: row.tieFallback,
    revealTopN: row.revealTopN === "all" ? "all" : Number(row.revealTopN),
    pickExpiryAction: row.pickExpiryAction,
    brokeTeamsFillAtEnd: row.brokeTeamsFillAtEnd,
  };
}

export function settingsToRow(leagueId: string, settings: DraftSettings): typeof schema.draftSettings.$inferInsert {
  return {
    leagueId,
    teamCount: settings.teamCount,
    budget: settings.startingBudget,
    auctionSpots: settings.auctionSpots,
    rosterSize: settings.rosterSize,
    positionGroups: settings.positionGroups,
    minBid: settings.minBid,
    bidStep: settings.bidStep,
    tieMinRaise: settings.tieMinRaise,
    nominationClockSec: settings.nominationClockSec === "off" ? null : settings.nominationClockSec,
    bidClockSec: settings.bidClockSec === "off" ? null : settings.bidClockSec,
    tieClockSec: settings.tieClockSec === "off" ? null : settings.tieClockSec,
    pickClockSec: settings.pickClockSec === "off" ? null : settings.pickClockSec,
    earlyClose: settings.earlyClose,
    maxTieRounds: settings.maxTieRounds,
    tieFallback: settings.tieFallback,
    noBidAction: settings.noBidAction,
    nominationOrder: settings.nominationOrder,
    revealTopN: String(settings.revealTopN),
    pickExpiryAction: settings.pickExpiryAction,
    brokeTeamsFillAtEnd: settings.brokeTeamsFillAtEnd,
  };
}

export function teamFromRow(row: TeamRow): Team {
  return { id: row.id, draftNumber: row.draftNumber, name: row.name };
}

export function playerFromRow(row: PlayerRow): Player {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    ...(row.nflTeam ? { nflTeam: row.nflTeam } : {}),
    ...(row.byeWeek !== null ? { byeWeek: row.byeWeek } : {}),
    ...(row.photoUrl ? { photoUrl: row.photoUrl } : {}),
  };
}

export function lotFromRow(row: LotRow): Lot {
  return {
    id: row.id,
    round: row.round,
    orderInRound: row.orderInRound,
    playerId: row.playerId,
    nominatedByTeamId: row.nominatedByTeamId,
    state: row.state,
    tieRound: row.tieRound,
    endsAt: row.endsAt ? row.endsAt.getTime() : null,
    remainingMs: row.remainingMs,
    eligibleTeamIds: (row.eligibleTeamIds as string[]) ?? [],
    tiedTeamIds: (row.tiedTeamIds as string[]) ?? [],
    winnerTeamId: row.winnerTeamId,
    price: row.price,
    ...(row.revealTopN !== null ? { revealTopN: row.revealTopN === "all" ? ("all" as const) : Number(row.revealTopN) } : {}),
  };
}

export function lotToRow(draftId: string, lot: Lot): typeof schema.lot.$inferInsert {
  return {
    id: lot.id,
    draftId,
    round: lot.round,
    orderInRound: lot.orderInRound,
    playerId: lot.playerId,
    nominatedByTeamId: lot.nominatedByTeamId,
    state: lot.state,
    tieRound: lot.tieRound,
    endsAt: lot.endsAt !== null ? new Date(lot.endsAt) : null,
    remainingMs: lot.remainingMs,
    eligibleTeamIds: lot.eligibleTeamIds,
    tiedTeamIds: lot.tiedTeamIds,
    winnerTeamId: lot.winnerTeamId,
    price: lot.price,
    revealTopN: lot.revealTopN === undefined ? null : String(lot.revealTopN),
  };
}

export function bidFromRow(row: BidRow): Bid {
  return {
    id: row.id,
    lotId: row.lotId,
    teamId: row.teamId,
    tieRound: row.tieRound,
    amount: row.amount,
    receivedAt: row.receivedAt.getTime(),
    superseded: row.superseded,
    ...(row.pass ? { pass: true } : {}),
  };
}

export function bidToRow(draftId: string, bid: Bid): typeof schema.bid.$inferInsert {
  return {
    id: bid.id,
    draftId,
    lotId: bid.lotId,
    teamId: bid.teamId,
    tieRound: bid.tieRound,
    amount: bid.amount,
    receivedAt: new Date(bid.receivedAt),
    superseded: bid.superseded,
    pass: bid.pass === true,
  };
}

export function pickFromRow(row: PickRow): Pick {
  return {
    id: row.id,
    pickNo: row.pickNo,
    round: row.round,
    teamId: row.teamId,
    playerId: row.playerId,
    source: row.source,
    price: row.price,
    madeAt: row.madeAt.getTime(),
  };
}

export function pickToRow(draftId: string, pick: Pick): typeof schema.pick.$inferInsert {
  return {
    id: pick.id,
    draftId,
    pickNo: pick.pickNo,
    round: pick.round,
    teamId: pick.teamId,
    playerId: pick.playerId,
    source: pick.source,
    price: pick.price,
    madeAt: new Date(pick.madeAt),
  };
}
