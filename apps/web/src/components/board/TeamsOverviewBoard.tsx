export type BoardTeamRow = {
  id: string;
  draftNumber: number;
  name: string;
  moneyLeft: number;
  spotsFilled: number;
  spotsTotal: number;
  broke: boolean;
};

/** Big board's right column: every team's money left and spots filled; broke teams in warn color. */
export function TeamsOverviewBoard({ rows }: { rows: BoardTeamRow[] }) {
  return (
    <div className="flex w-[400px] flex-shrink-0 flex-col overflow-hidden rounded-[24px] border border-line bg-surface">
      <div className="grid grid-cols-[56px_minmax(0,1fr)_88px_64px] gap-2 border-b border-line px-5 py-4 text-[15px] font-bold uppercase tracking-[0.06em] text-muted">
        <span>#</span>
        <span>Team</span>
        <span className="text-right">Left</span>
        <span className="text-right">Spots</span>
      </div>
      {rows
        .slice()
        .sort((a, b) => a.draftNumber - b.draftNumber)
        .map((row) => (
          <div
            key={row.id}
            className={`grid grid-cols-[56px_minmax(0,1fr)_88px_64px] gap-2 px-5 py-2.5 text-xl ${row.broke ? "bg-warn-bg text-warn" : ""}`}
          >
            <span>{row.draftNumber}</span>
            <span>
              {row.name}
              {row.broke ? " · broke" : ""}
            </span>
            <span className="text-right font-bold">${row.moneyLeft}</span>
            <span className="text-right">
              {row.spotsFilled}/{row.spotsTotal}
            </span>
          </div>
        ))}
    </div>
  );
}
