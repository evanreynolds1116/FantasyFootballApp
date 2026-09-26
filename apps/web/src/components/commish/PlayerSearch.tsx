import { availablePlayerIds } from "@draft-app/engine";
import { useState, type ReactNode } from "react";
import type { DraftSnapshot } from "../../lib/contracts";
import { asEngineState } from "../../store/selectors";

type PoolPlayer = DraftSnapshot["players"][number];

/** Search the players still available (not drafted, not up for bid, not unavailable), with one action per result. */
export function PlayerSearch({
  snapshot,
  label,
  action,
}: {
  snapshot: DraftSnapshot;
  label: string;
  action: (player: PoolPlayer) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const available = new Set(availablePlayerIds(asEngineState(snapshot)));
  const results = term
    ? snapshot.players
        .filter((p) => available.has(p.id) && (p.name.toLowerCase().includes(term) || p.position.toLowerCase() === term || p.nflTeam?.toLowerCase() === term))
        .slice(0, 6)
    : [];

  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="search"
        aria-label={label}
        placeholder="Player name, position or NFL team"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-11 w-full rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent"
      />
      {term && results.length === 0 && <div className="text-sm text-muted">No available players match.</div>}
      {results.length > 0 && (
        <ul className="flex flex-col rounded-ctl border border-line">
          {results.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-sm last:border-b-0">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{p.name}</span>
                <span className="text-muted">
                  {" · "}
                  {p.position}
                  {p.nflTeam ? ` · ${p.nflTeam}` : ""}
                </span>
              </span>
              {action(p)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
