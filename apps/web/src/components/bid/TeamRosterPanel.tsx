import type { Pick as EnginePick, Player, PositionGroup } from "@draft-app/engine";

type Props = {
  picks: EnginePick[];
  players: Player[];
  positionGroups: PositionGroup[] | null;
  auctionSpotsFilled: number;
  auctionSpots: number;
  spent: number;
  positionGroupCountForLive: number | null;
  liveGroup: PositionGroup | undefined;
};

function initials(name: string): string {
  const parts = name.split(" ");
  if (parts.length < 2) return name;
  return `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
}

export function TeamRosterPanel({ picks, players, positionGroups, auctionSpotsFilled, auctionSpots, spent, liveGroup, positionGroupCountForLive }: Props) {
  const playerById = new Map(players.map((p) => [p.id, p]));
  const groups = positionGroups ?? [];

  return (
    <div className="flex flex-col gap-2.5 rounded-panel border border-line bg-surface px-7 py-5">
      <div className="flex items-baseline justify-between">
        <span className="label">
          Your roster · {auctionSpotsFilled} of {auctionSpots} auction spots · ${spent} spent
        </span>
        {liveGroup && positionGroupCountForLive !== null && (
          <span className="text-sm text-muted">
            {liveGroup.name} {positionGroupCountForLive} of {liveGroup.min}–{liveGroup.max}
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {groups.map((group) => {
          const groupPicks = picks.filter((p) => {
            const player = playerById.get(p.playerId);
            return player && group.positions.includes(player.position);
          });
          return (
            <div key={group.name} className="rounded-[10px] bg-surface-2 px-3 py-2.5">
              <div className="text-xs font-bold text-accent">{group.name}</div>
              {groupPicks.length === 0 ? (
                <div className="text-sm text-muted">—</div>
              ) : (
                <>
                  <div className="text-[15px] font-semibold">
                    {groupPicks.map((p) => initials(playerById.get(p.playerId)?.name ?? "?")).join(" · ")}
                  </div>
                  <div className="text-[13px] text-muted">{groupPicks.map((p) => (p.price !== null ? `$${p.price}` : "—")).join(" · ")}</div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
