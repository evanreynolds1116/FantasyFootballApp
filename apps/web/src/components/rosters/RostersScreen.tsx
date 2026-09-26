import { useRef, useState, type Ref } from "react";
import type { DraftSnapshot } from "../../lib/contracts";
import { useIsLaptop } from "../../lib/useMediaQuery";
import { useDraft } from "../../store/DraftProvider";
import { StatTile } from "../primitives/StatTile";
import { acquiredLabel, groupLimitLabel, rosterByGroup, teamSummaries, type TeamSummary } from "./rosterData";

export function TeamsTable({ rows, selectedId, onSelect }: { rows: TeamSummary[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full table-fixed text-left text-[15px]">
        <thead className="label border-b border-line">
          <tr>
            <th scope="col" className="w-10 py-3 pl-4 pr-1.5 font-bold">
              #
            </th>
            <th scope="col" className="px-1.5 py-3 font-bold">
              Team
            </th>
            <th scope="col" className="w-16 px-1.5 py-3 text-right font-bold">
              Left
            </th>
            <th scope="col" className="hidden w-20 px-1.5 py-3 text-right font-bold sm:table-cell">
              Max bid
            </th>
            <th scope="col" className="w-14 px-1.5 py-3 text-right font-bold">
              <abbr title="Auction spots left" className="no-underline">
                Spots
              </abbr>
            </th>
            <th scope="col" className="w-[4.5rem] py-3 pl-1.5 pr-4 text-right font-bold">
              Roster
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = row.id === selectedId;
            return (
              <tr
                key={row.id}
                onClick={() => onSelect(row.id)}
                className={`cursor-pointer border-l-4 ${selected ? "border-accent bg-chip" : "border-transparent"} ${row.broke ? "text-warn" : ""}`}
              >
                <td className="py-2.5 pl-3 pr-1.5">{row.draftNumber}</td>
                <td className="px-1.5 py-2.5">
                  {/* A real button inside the row keeps it keyboard- and screen-reader-reachable; the row click is a larger tap target for the same thing. */}
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(row.id);
                    }}
                    className="flex w-full flex-col text-left"
                  >
                    <span className={`truncate ${row.isMe ? "font-semibold" : ""}`}>{row.name}</span>
                    {/* Own line so truncating a long name never hides these — broke must never be shown by color alone (UI.md). */}
                    {(row.isMe || row.broke) && (
                      <span className="text-xs font-semibold uppercase tracking-[0.06em]">
                        {row.isMe && <span className="text-muted">You</span>}
                        {row.isMe && row.broke && " · "}
                        {row.broke && "Broke"}
                      </span>
                    )}
                  </button>
                </td>
                <td className="px-1.5 py-2.5 text-right font-bold">${row.moneyLeft}</td>
                <td className="hidden px-1.5 py-2.5 text-right sm:table-cell">${row.maxBid}</td>
                <td className="px-1.5 py-2.5 text-right">{row.auctionSpotsLeft}</td>
                <td className="py-2.5 pl-1.5 pr-4 text-right">{row.rosterCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TeamDetail({ snapshot, team, sectionRef }: { snapshot: DraftSnapshot; team: TeamSummary; sectionRef: Ref<HTMLElement> }) {
  const groups = rosterByGroup(snapshot, team.id);
  const { rosterSize, auctionSpots } = snapshot.settings;

  return (
    <section ref={sectionRef} aria-labelledby="team-detail" className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="team-detail" className="font-display text-2xl font-extrabold uppercase">
          <span className="text-muted">{team.draftNumber} · </span>
          {team.name}
        </h2>
        {team.broke && (
          <span className="rounded-full border border-warn-border bg-warn-bg px-2.5 py-0.5 text-[13px] font-bold uppercase tracking-[0.06em] text-warn">
            Broke
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Money left" value={`$${team.moneyLeft}`} />
        <StatTile label="Max bid" value={`$${team.maxBid}`} />
        <StatTile label="Auction spots left" value={`${team.auctionSpotsLeft} of ${auctionSpots}`} />
        <StatTile label="Roster" value={`${team.rosterCount} of ${rosterSize}`} />
      </div>

      {team.broke && (
        <div className="text-sm text-warn">
          Can&apos;t afford the ${snapshot.settings.minBid} minimum bid, so this team skips nominating and bidding and fills its{" "}
          {team.auctionSpotsLeft} open auction {team.auctionSpotsLeft === 1 ? "spot" : "spots"} in make-up rounds after the snake.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {groups.map((g) => {
          const belowMin = g.group !== null && g.count < g.group.min;
          const atMax = g.group !== null && g.count >= g.group.max;
          return (
            <div key={g.label} className="rounded-[10px] bg-surface-2 px-3.5 py-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-bold uppercase tracking-[0.06em] text-accent">{g.label}</span>
                <span className="text-[13px] text-muted">
                  {groupLimitLabel(g)}
                  {belowMin && " · needs more"}
                  {atMax && " · full"}
                </span>
              </div>
              {g.entries.length === 0 ? (
                <div className="text-sm text-muted">Nobody yet</div>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {g.entries.map(({ pick, player }) => (
                    <li key={pick.id} className="flex items-baseline justify-between gap-3 text-[15px]">
                      <span className="min-w-0 truncate">
                        <span className="font-semibold">{player?.name ?? "Unknown player"}</span>
                        <span className="text-muted">
                          {" · "}
                          {player?.position ?? "?"}
                          {player?.nflTeam ? ` · ${player.nflTeam}` : ""}
                        </span>
                      </span>
                      <span className={`flex-shrink-0 ${pick.source === "auction" ? "font-bold" : "text-muted"}`}>{acquiredLabel(pick)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Rosters & budgets (SPEC.md screens table): every team's money left, max
 * bid, auction spots left, roster count and broke flag, plus one team's
 * roster by position. Read-only and live — it re-renders from the same
 * snapshot every other screen uses.
 */
export function RostersScreen() {
  const { snapshot } = useDraft();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const isLaptop = useIsLaptop();
  const detailRef = useRef<HTMLElement>(null);

  // Below laptop width the detail stacks under the table, so bring it into view on a tap.
  const select = (id: string) => {
    setChosenId(id);
    if (!isLaptop) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  if (!snapshot) return <div className="flex flex-grow items-center justify-center text-muted">Loading draft…</div>;

  const rows = teamSummaries(snapshot);
  const selected = rows.find((r) => r.id === chosenId) ?? rows.find((r) => r.isMe) ?? rows[0];
  if (!selected) return <div className="flex flex-grow items-center justify-center text-muted">No teams in this draft yet.</div>;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-grow flex-col gap-4 py-4">
      <h1 className="font-display text-[26px] font-extrabold uppercase">Rosters &amp; budgets</h1>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <TeamsTable rows={rows} selectedId={selected.id} onSelect={select} />
        <TeamDetail snapshot={snapshot} team={selected} sectionRef={detailRef} />
      </div>
    </div>
  );
}
