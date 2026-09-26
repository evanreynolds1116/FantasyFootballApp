import type { CommishEdit, Lot, Pick, Player, Team } from "../model/types.js";

/**
 * What the results log reads. It must be a PUBLIC view of the draft — the
 * bid-scrubbed snapshot every client gets, where a bid carries `amount` only
 * if the reveal showed it. Never pass the server's full DraftState: every bid
 * there has an amount, and hidden losing bids would end up in the export.
 */
export type PublicResultsView = {
  teams: Team[];
  players: Player[];
  picks: Pick[];
  lots: Lot[];
  bids: { lotId: string; teamId: string; tieRound: number; superseded: boolean; amount?: number }[];
  commishLog: CommishEdit[];
};

export type LogEntry = {
  pickNo: number;
  /** "Auction R3", "Snake R2", "Make-up R1", "Commissioner". */
  stage: string;
  teamNumber: number;
  teamName: string;
  playerName: string;
  position: string;
  nflTeam: string;
  /** Auction price; null for snake/make-up picks. */
  price: number | null;
  /** How the player was acquired beyond the stage: "auto-pick", "tie-break (2 rounds)", "no bids, nominator", "added by commissioner". */
  note: string;
  /** Other revealed opening bids on this lot, high to low (never the hidden ones — the public view doesn't have them). */
  runnerUps: { teamNumber: number; amount: number }[];
};

const STAGE: Record<Pick["source"], string> = { auction: "Auction", snake: "Snake", auto: "Snake", makeup: "Make-up" };

/** Every pick in draft order, with what the league saw at each reveal (FR-18). */
export function draftLog(view: PublicResultsView): LogEntry[] {
  const teamById = new Map(view.teams.map((t) => [t.id, t]));
  const playerById = new Map(view.players.map((p) => [p.id, p]));
  const assigned = new Set(view.commishLog.flatMap((e) => (e.kind === "assign" ? [e.pickId] : [])));

  return [...view.picks]
    .sort((a, b) => a.pickNo - b.pickNo)
    .map((pick) => {
      const team = teamById.get(pick.teamId);
      const player = playerById.get(pick.playerId);
      const byCommissioner = assigned.has(pick.id);
      const lot =
        pick.source === "auction" && !byCommissioner
          ? view.lots.find((l) => l.playerId === pick.playerId && l.state === "awarded" && l.winnerTeamId === pick.teamId)
          : undefined;
      const openingBids = lot ? view.bids.filter((b) => b.lotId === lot.id && b.tieRound === 0 && !b.superseded && b.amount !== undefined) : [];
      const runnerUps = openingBids
        .filter((b) => b.teamId !== pick.teamId)
        .map((b) => ({ teamNumber: teamById.get(b.teamId)?.draftNumber ?? 0, amount: b.amount as number }))
        .sort((a, b) => b.amount - a.amount);
      // A winning bid is always revealed (reveal shows at least the winner), so no revealed opening
      // amounts means nobody bid — even if the lot has pass rows, which look like hidden bids.
      const hadAnyBid = lot ? openingBids.length > 0 : true;

      let note = "";
      if (byCommissioner) note = "added by commissioner";
      else if (pick.source === "auto") note = "auto-pick";
      else if (lot && lot.tieRound > 0) note = `tie-break (${lot.tieRound} re-bid round${lot.tieRound === 1 ? "" : "s"})`;
      else if (lot && !hadAnyBid) note = "no bids, nominator";

      return {
        pickNo: pick.pickNo,
        stage: byCommissioner ? "Commissioner" : `${STAGE[pick.source]} R${pick.round}`,
        teamNumber: team?.draftNumber ?? 0,
        teamName: team?.name ?? "?",
        playerName: player?.name ?? "Unknown player",
        position: player?.position ?? "",
        nflTeam: player?.nflTeam ?? "",
        price: pick.price,
        note,
        runnerUps,
      };
    });
}

function csvField(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  // Quote anything with a delimiter, quote or line break; and neutralize a leading =, +, - or @ so a spreadsheet never runs it as a formula.
  const safe = /^[=+\-@]/.test(s) && typeof value === "string" ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** FR-18 results export: one row per pick, in draft order, with the runner-up bids that were revealed. */
export function buildResultsCsv(view: PublicResultsView): string {
  const header = ["pick", "stage", "team_number", "team", "player", "position", "nfl_team", "price", "note", "revealed_runner_up_bids"];
  const rows = draftLog(view).map((e) => [
    e.pickNo,
    e.stage,
    e.teamNumber,
    e.teamName,
    e.playerName,
    e.position,
    e.nflTeam,
    e.price,
    e.note,
    e.runnerUps.map((r) => `Team ${r.teamNumber} $${r.amount}`).join("; "),
  ]);
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
