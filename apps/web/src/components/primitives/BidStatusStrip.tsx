import type { Team } from "@draft-app/engine";

type Props = {
  teams: Team[];
  hasBidTeamIds: ReadonlySet<string>;
  eligibleTeamIds: ReadonlySet<string>;
  size: "phone" | "laptop" | "board";
};

const sizeClasses = {
  phone: "h-[26px] text-[11px] gap-1",
  laptop: "h-10 text-base gap-2",
  board: "h-[50px] text-2xl gap-2.5",
};

/** "N of M are in" + one tile per team: solid amber (bid or pass — deliberately identical), dashed (not yet), dimmed "out" (ineligible). Never an amount. */
export function BidStatusStrip({ teams, hasBidTeamIds, eligibleTeamIds, size }: Props) {
  const bidCount = teams.filter((t) => hasBidTeamIds.has(t.id)).length;
  const cellHeight = sizeClasses[size].match(/h-\S+/)?.[0] ?? "h-10";
  const textSize = sizeClasses[size].match(/text-\S+/)?.[0] ?? "text-base";

  return (
    <div className="flex flex-col gap-2.5">
      <div className={`flex justify-between ${textSize} text-muted`}>
        <span>
          <strong className="text-text">
            {bidCount} of {teams.length}
          </strong>{" "}
          are in
        </span>
        <span>Amounts stay hidden{size !== "phone" ? " until the clock hits zero" : ""}</span>
      </div>
      <div className="grid grid-cols-12 gap-1.5 md:gap-2">
        {teams
          .slice()
          .sort((a, b) => a.draftNumber - b.draftNumber)
          .map((t) => {
            const eligible = eligibleTeamIds.has(t.id);
            const hasBid = hasBidTeamIds.has(t.id);
            if (!eligible) {
              return (
                <div
                  key={t.id}
                  title={`Team ${t.draftNumber} is not eligible for this lot`}
                  className={`${cellHeight} rounded-[10px] bg-[#1A221D] text-[#6F7E72] flex items-center justify-center font-bold ${size === "board" ? "text-[15px]" : "text-[11px]"}`}
                >
                  {size === "board" ? `${t.draftNumber} · out` : t.draftNumber}
                </div>
              );
            }
            if (hasBid) {
              return (
                <div
                  key={t.id}
                  title={`Team ${t.draftNumber} has bid`}
                  className={`${cellHeight} rounded-[10px] bg-accent text-on-accent flex items-center justify-center font-extrabold ${textSize}`}
                >
                  {t.draftNumber}
                </div>
              );
            }
            return (
              <div
                key={t.id}
                title={`Team ${t.draftNumber} has not bid`}
                className={`${cellHeight} rounded-[10px] border border-dashed border-line-dashed text-muted flex items-center justify-center font-semibold ${textSize}`}
              >
                {t.draftNumber}
              </div>
            );
          })}
      </div>
    </div>
  );
}
