export type TeamRow = {
  id: string;
  draftNumber: number;
  name: string;
  maxBid: number;
  spotsFilled: number;
  spotsTotal: number;
  positionCount: number;
  eligible: boolean;
  broke: boolean;
  isMe: boolean;
};

/** Laptop bid screen's right column: every team's max bid, spots and count at the live lot's position. */
export function AllTeamsPanel({ rows, positionLabel }: { rows: TeamRow[]; positionLabel: string }) {
  return (
    <div className="flex w-[360px] flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="label grid grid-cols-[32px_minmax(0,1fr)_64px_48px_44px] gap-1.5 border-b border-line px-4 py-3.5">
        <span>#</span>
        <span>Team</span>
        <span className="text-right">Max bid</span>
        <span className="text-right">Spots</span>
        <span className="text-right">{positionLabel}</span>
      </div>
      {rows
        .slice()
        .sort((a, b) => a.draftNumber - b.draftNumber)
        .map((row) => (
          <div
            key={row.id}
            className={`grid grid-cols-[32px_minmax(0,1fr)_64px_48px_44px] gap-1.5 px-4 py-2.5 text-[15px] ${
              row.isMe ? "bg-chip font-semibold" : !row.eligible ? "text-muted" : row.broke ? "text-warn" : ""
            }`}
          >
            <span>{row.draftNumber}</span>
            <span>
              {row.name}
              {row.broke ? " · broke" : !row.eligible ? " · can't bid" : ""}
            </span>
            <span className="text-right font-bold">${row.maxBid}</span>
            <span className="text-right">
              {row.spotsFilled}/{row.spotsTotal}
            </span>
            <span className="text-right">{row.positionCount}</span>
          </div>
        ))}
      <div className="mt-auto border-t border-line px-4 py-3.5 text-[13px] text-muted">
        Greyed teams can&apos;t bid on this player. The {positionLabel} column follows the player up for bid.
      </div>
    </div>
  );
}
