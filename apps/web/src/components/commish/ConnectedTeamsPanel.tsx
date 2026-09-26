import type { DraftSnapshot } from "../../lib/contracts";

/**
 * "Who's connected": one tile per team by draft number. Offline teams get
 * the warn style plus a dashed border and a ✕, never color alone. A team
 * nobody has claimed yet counts as offline — nobody can act for it.
 */
export function ConnectedTeamsPanel({ snapshot }: { snapshot: DraftSnapshot }) {
  const online = new Set(snapshot.connectedTeamIds);
  const teams = [...snapshot.teams].sort((a, b) => a.draftNumber - b.draftNumber);
  const offlineCount = teams.filter((t) => !online.has(t.id)).length;

  return (
    <section aria-labelledby="whos-connected" className="flex flex-col gap-2 rounded-[14px] bg-surface p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 id="whos-connected" className="label">
          Who&apos;s connected
        </h2>
        {offlineCount > 0 ? (
          <span className="text-[13px] font-semibold text-warn">{offlineCount} offline</span>
        ) : (
          <span className="text-[13px] font-semibold text-success">Everyone&apos;s here</span>
        )}
      </div>
      <ul className="grid grid-cols-6 gap-1.5">
        {teams.map((team) => {
          const isOnline = online.has(team.id);
          return (
            <li
              key={team.id}
              title={team.name}
              aria-label={`Team ${team.draftNumber}, ${team.name}: ${isOnline ? "connected" : "offline"}`}
              className={
                isOnline
                  ? "rounded-lg bg-[#1E3325] py-1.5 text-center text-[13px] font-bold text-success"
                  : "rounded-lg border border-dashed border-warn py-[5px] text-center text-[13px] font-bold text-warn"
              }
            >
              {team.draftNumber}
              {!isOnline && " ✕"}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
