import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type PoolPlayer } from "../../lib/api";
import { QueueStar } from "../queue/QueueStar";

const inputClass = "h-11 w-full rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent";

/**
 * Build your ranked queue before the draft (FR-19): search the league's pool,
 * star players, put them in order. It carries straight into the draft, where
 * it's used if your nomination or pick clock runs out. Private to you.
 */
export function MyQueuePanel({ token, leagueId, playerCount }: { token: string; leagueId: string; playerCount: number }) {
  const [queue, setQueue] = useState<string[] | null>(null);
  const [players, setPlayers] = useState<PoolPlayer[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ playerIds: string[] }>(token, "GET", `/leagues/${leagueId}/queue`)
      .then((r) => setQueue(r.playerIds))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your queue."));
  }, [token, leagueId]);

  // Re-read the pool whenever its size changes (the commissioner uploading or editing it).
  useEffect(() => {
    if (playerCount === 0) return setPlayers([]);
    api<{ players: PoolPlayer[] }>(token, "GET", `/leagues/${leagueId}/players`)
      .then((r) => setPlayers(r.players))
      .catch(() => setError("Could not load the player pool."));
  }, [token, leagueId, playerCount]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const save = async (next: string[]) => {
    const previous = queue;
    setQueue(next);
    setError("");
    try {
      await api(token, "PUT", `/leagues/${leagueId}/queue`, { playerIds: next });
    } catch (err) {
      setQueue(previous);
      setError(err instanceof ApiError ? err.message : "Could not save your queue.");
    }
  };

  if (queue === null) return null;
  const toggle = (id: string) => void save(queue.includes(id) ? queue.filter((q) => q !== id) : [...queue, id]);
  const move = (i: number, delta: -1 | 1) => {
    const next = [...queue];
    [next[i], next[i + delta]] = [next[i + delta]!, next[i]!];
    void save(next);
  };
  const q = query.trim().toLowerCase();
  const results = q ? players.filter((p) => p.name.toLowerCase().includes(q) || p.position.toLowerCase() === q || p.nflTeam?.toLowerCase() === q).slice(0, 8) : [];

  return (
    <section aria-labelledby="my-queue" className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 id="my-queue" className="label">
          My queue
        </h2>
        <span className="text-sm text-muted">{queue.length} players · only you can see it</span>
      </div>
      <p className="text-sm text-muted">
        Rank the players you want, best first. If your clock runs out in the draft, the top available one is nominated or picked for you.
      </p>

      {players.length === 0 ? (
        <div className="text-sm text-muted">The player pool isn&apos;t loaded yet.</div>
      ) : (
        <>
          <input type="search" aria-label="Find a player to queue" placeholder="Find a player (name, position or team)" value={query} onChange={(e) => setQuery(e.target.value)} className={inputClass} />
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
                  <QueueStar queued={queue.includes(p.id)} onToggle={() => toggle(p.id)} name={p.name} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {queue.length > 0 && (
        <ol className="flex flex-col rounded-ctl border border-line">
          {queue.map((id, i) => {
            const p = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-sm last:border-b-0">
                <span className="w-6 text-center font-display text-base font-extrabold text-muted">{i + 1}</span>
                <span className="min-w-0 flex-grow truncate">
                  <span className="font-semibold">{p?.name ?? "Removed player"}</span>
                  {p && <span className="text-muted"> · {p.position}</span>}
                </span>
                <button type="button" aria-label={`Move ${p?.name ?? "player"} up`} disabled={i === 0} onClick={() => move(i, -1)} className="h-8 w-8 rounded-lg bg-surface-2 disabled:opacity-30">
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${p?.name ?? "player"} down`}
                  disabled={i === queue.length - 1}
                  onClick={() => move(i, 1)}
                  className="h-8 w-8 rounded-lg bg-surface-2 disabled:opacity-30"
                >
                  ↓
                </button>
                <button type="button" aria-label={`Remove ${p?.name ?? "player"} from your queue`} onClick={() => toggle(id)} className="h-8 w-8 rounded-lg border border-line text-muted">
                  ✕
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}
    </section>
  );
}
