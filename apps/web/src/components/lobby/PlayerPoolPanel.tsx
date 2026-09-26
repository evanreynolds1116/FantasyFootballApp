import { useState } from "react";
import { api, ApiError, type NewPlayer, type PoolPlayer } from "../../lib/api";
import { normalizePosition, parsePlayerCsv, type CsvParseResult } from "../../lib/playerCsv";

const inputClass = "h-11 w-full rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent";
const MAX_SHOWN_ERRORS = 5;

function CsvUpload({ token, leagueId, poolSize, onUploaded }: { token: string; leagueId: string; poolSize: number; onUploaded: (message: string) => void }) {
  const [parsed, setParsed] = useState<(CsvParseResult & { fileName: string }) | null>(null);
  const [replace, setReplace] = useState(poolSize > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onFile = async (file: File | undefined) => {
    setError("");
    setParsed(null);
    if (!file) return;
    setParsed({ ...parsePlayerCsv(await file.text()), fileName: file.name });
  };

  const upload = async () => {
    if (!parsed || parsed.players.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const res = await api<{ added: number; skipped: number }>(token, "POST", `/leagues/${leagueId}/players`, { players: parsed.players, replace });
      setParsed(null);
      onUploaded(`Added ${res.added} players${res.skipped > 0 ? ` (${res.skipped} skipped as duplicates of an MFL id already in the pool)` : ""}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm text-muted">
        Upload a CSV
        <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} className="text-sm text-text file:mr-3 file:h-10 file:rounded-ctl file:border-0 file:bg-surface-2 file:px-3 file:font-semibold file:text-text" />
        <span className="text-xs">
          Needs a header row with name and position; NFL team, bye week and MFL id are optional. An MFL player export saved as CSV works — &quot;Last, First&quot; names and PK/Def positions are converted.
        </span>
      </label>
      {parsed && (
        <div className="flex flex-col gap-2 rounded-ctl bg-surface-2 p-3 text-sm">
          <span>
            <strong>{parsed.fileName}</strong>: {parsed.players.length} players ready
            {parsed.errors.length > 0 && <span className="text-warn">, {parsed.errors.length} problem{parsed.errors.length === 1 ? "" : "s"}</span>}.
          </span>
          {parsed.errors.length > 0 && (
            <ul className="list-disc pl-5 text-warn">
              {parsed.errors.slice(0, MAX_SHOWN_ERRORS).map((e) => (
                <li key={e}>{e}</li>
              ))}
              {parsed.errors.length > MAX_SHOWN_ERRORS && <li>…and {parsed.errors.length - MAX_SHOWN_ERRORS} more.</li>}
            </ul>
          )}
          {poolSize > 0 && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="h-5 w-5 accent-[#F2B84B]" />
              Replace the {poolSize} players already in the pool
            </label>
          )}
          <button
            type="button"
            disabled={busy || parsed.players.length === 0}
            onClick={() => void upload()}
            className="h-11 self-start rounded-ctl bg-accent px-4 font-bold text-on-accent disabled:opacity-40"
          >
            {busy ? "Uploading…" : replace && poolSize > 0 ? `Replace pool with ${parsed.players.length}` : `Add ${parsed.players.length} players`}
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}
    </div>
  );
}

function ManualAdd({ token, leagueId, onAdded }: { token: string; leagueId: string; onAdded: (message: string) => void }) {
  const [p, setP] = useState({ name: "", position: "", nflTeam: "", byeWeek: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const bye = p.byeWeek.trim() ? Number(p.byeWeek) : undefined;
    if (!p.name.trim() || !p.position.trim()) return setError("A name and position are required.");
    if (bye !== undefined && !(Number.isInteger(bye) && bye >= 1 && bye <= 18)) return setError("Bye week must be 1–18.");
    const player: NewPlayer = { name: p.name.trim(), position: normalizePosition(p.position), custom: true };
    if (p.nflTeam.trim()) player.nflTeam = p.nflTeam.trim().toUpperCase();
    if (bye !== undefined) player.byeWeek = bye;
    setBusy(true);
    setError("");
    try {
      await api(token, "POST", `/leagues/${leagueId}/players`, { players: [player] });
      setP({ name: "", position: "", nflTeam: "", byeWeek: "" });
      onAdded(`Added ${player.name}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the player.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={add} className="flex flex-col gap-2">
      <span className="text-sm text-muted">Add one player</span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <input aria-label="Player name" placeholder="Name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} className={`${inputClass} col-span-2 sm:col-span-1`} />
        <input aria-label="Position" placeholder="Pos" value={p.position} onChange={(e) => setP({ ...p, position: e.target.value })} className={inputClass} />
        <input aria-label="NFL team" placeholder="Team" value={p.nflTeam} onChange={(e) => setP({ ...p, nflTeam: e.target.value })} className={inputClass} />
        <input aria-label="Bye week" placeholder="Bye" inputMode="numeric" value={p.byeWeek} onChange={(e) => setP({ ...p, byeWeek: e.target.value })} className={inputClass} />
      </div>
      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}
      <button type="submit" disabled={busy} className="h-11 self-start rounded-ctl border border-line px-4 text-[15px] font-semibold disabled:opacity-40">
        Add player
      </button>
    </form>
  );
}

function PoolList({ token, leagueId, canEdit, onRemoved }: { token: string; leagueId: string; canEdit: boolean; onRemoved: () => void }) {
  const [players, setPlayers] = useState<PoolPlayer[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setPlayers((await api<{ players: PoolPlayer[] }>(token, "GET", `/leagues/${leagueId}/players`)).players);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the pool.");
    }
  };

  const remove = async (id: string) => {
    try {
      await api(token, "DELETE", `/leagues/${leagueId}/players/${id}`);
      setPlayers((ps) => ps?.filter((p) => p.id !== id) ?? null);
      onRemoved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the player.");
    }
  };

  if (!players) {
    return (
      <button type="button" onClick={() => void load()} className="self-start text-sm font-semibold text-muted underline hover:text-text">
        Show the players
      </button>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = q ? players.filter((p) => p.name.toLowerCase().includes(q) || p.position.toLowerCase() === q || p.nflTeam?.toLowerCase() === q) : players;
  return (
    <div className="flex flex-col gap-2">
      <input type="search" aria-label="Search the pool" placeholder="Search name, position or team" value={query} onChange={(e) => setQuery(e.target.value)} className={inputClass} />
      <ul className="max-h-80 overflow-y-auto rounded-ctl border border-line">
        {shown.slice(0, 200).map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-sm last:border-b-0">
            <span className="min-w-0 truncate">
              <span className="font-semibold">{p.name}</span>
              <span className="text-muted">
                {" · "}
                {p.position}
                {p.nflTeam ? ` · ${p.nflTeam}` : ""}
                {p.byeWeek ? ` · bye ${p.byeWeek}` : ""}
              </span>
            </span>
            {canEdit && (
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => void remove(p.id)} className="h-8 flex-shrink-0 rounded-lg px-2 text-muted hover:text-warn">
                Remove
              </button>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">No players match.</li>}
      </ul>
      {shown.length > 200 && <span className="text-xs text-muted">Showing 200 of {shown.length} — search to narrow it down.</span>}
      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}
    </div>
  );
}

/** FR-04 player pool: how many players, and (commissioner) CSV upload, manual add, remove. */
export function PlayerPoolPanel({
  token,
  leagueId,
  playerCount,
  needed,
  isCommissioner,
  locked,
  onChanged,
}: {
  token: string;
  leagueId: string;
  playerCount: number;
  needed: number;
  isCommissioner: boolean;
  locked: boolean;
  onChanged: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [listKey, setListKey] = useState(0);
  const changed = (message: string) => {
    setNotice(message);
    setListKey((k) => k + 1);
    onChanged();
  };
  const canEdit = isCommissioner && !locked;

  return (
    <section aria-labelledby="pool" className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="pool" className="label">
          Player pool
        </h2>
        <span className={`text-sm font-semibold ${playerCount >= needed ? "text-success" : "text-warn"}`}>
          {playerCount} players{playerCount < needed ? ` · need at least ${needed}` : ""}
        </span>
      </div>
      {canEdit && (
        <>
          <CsvUpload token={token} leagueId={leagueId} poolSize={playerCount} onUploaded={changed} />
          <ManualAdd token={token} leagueId={leagueId} onAdded={changed} />
        </>
      )}
      {notice && (
        <div role="status" className="text-sm font-semibold text-success">
          {notice}
        </div>
      )}
      {playerCount > 0 && <PoolList key={listKey} token={token} leagueId={leagueId} canEdit={canEdit} onRemoved={onChanged} />}
    </section>
  );
}
