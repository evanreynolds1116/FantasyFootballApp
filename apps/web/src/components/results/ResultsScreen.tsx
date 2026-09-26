import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { CommishLogList } from "../commish/CommishLogPanel";
import { useDraft } from "../../store/DraftProvider";
import { TeamDetail, TeamsTable } from "../rosters/RostersScreen";
import { teamSummaries } from "../rosters/rosterData";
import { draftLog, type LogEntry } from "./resultsData";

type Tab = "rosters" | "log";

/** Downloads the server's results CSV (GET /drafts/:id/export.csv), the same file for everyone in the league. */
async function downloadResults(token: string, draftId: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`/drafts/${draftId}/export.csv`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    return "Can't reach the server. Try again.";
  }
  if (!res.ok) return res.status === 403 ? "Only the league's managers and commissioner can download the results." : "Couldn't download the results.";
  const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "draft-results.csv";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
}

function LogRow({ e }: { e: LogEntry }) {
  return (
    <li className="flex items-start gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0">
      <span className="w-9 flex-shrink-0 pt-0.5 text-right font-display text-lg font-extrabold text-muted">{e.pickNo}</span>
      <div className="flex min-w-0 flex-grow flex-col">
        <span className="truncate">
          <span className="font-semibold">{e.playerName}</span>
          <span className="text-muted">
            {" · "}
            {e.position}
            {e.nflTeam ? ` · ${e.nflTeam}` : ""}
          </span>
        </span>
        <span className="text-[13px] text-muted">
          {e.stage} · Team {e.teamNumber} {e.teamName}
          {e.note && ` · ${e.note}`}
        </span>
        {e.runnerUps.length > 0 && (
          <span className="text-[13px] text-muted">Next bids: {e.runnerUps.map((r) => `$${r.amount} (Team ${r.teamNumber})`).join(", ")}</span>
        )}
      </div>
      <span className={`flex-shrink-0 pt-0.5 ${e.price !== null ? "font-display text-xl font-extrabold" : "text-sm text-muted"}`}>{e.price !== null ? `$${e.price}` : "—"}</span>
    </li>
  );
}

/**
 * SPEC Flow 4 "After the draft": final rosters and spend per team, the full
 * pick log (with only the bids the reveals actually showed), and a CSV
 * export. Shown on the draft screen and on the big board once the draft is
 * complete — the big board's link needs no login, so it doubles as the
 * shareable results page.
 */
export function ResultsScreen({ variant = "page" }: { variant?: "page" | "board" }) {
  const { snapshot } = useDraft();
  const { draftId } = useParams<{ draftId: string }>();
  const token = useAuth().session?.token;
  const [downloadError, setDownloadError] = useState("");
  const [tab, setTab] = useState<Tab>("rosters");
  const [chosenId, setChosenId] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const log = useMemo(() => (snapshot ? draftLog(snapshot) : []), [snapshot]);

  if (!snapshot) return null;
  const rows = teamSummaries(snapshot);
  const selected = rows.find((r) => r.id === chosenId) ?? rows.find((r) => r.isMe) ?? rows[0];
  // From prices, not budget left: commissioner budget adjustments aren't spending.
  const totalSpent = snapshot.picks.reduce((sum, p) => sum + (p.price ?? 0), 0);
  const board = variant === "board";

  return (
    <div className={`mx-auto flex w-full flex-grow flex-col gap-4 ${board ? "max-w-[1500px] py-2" : "max-w-5xl py-4"}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="label">Draft complete</span>
          <h1 className={`font-display font-extrabold uppercase leading-none ${board ? "text-[56px]" : "text-[30px]"}`}>Final results</h1>
          <span className="text-muted">
            {snapshot.picks.length} players drafted · ${totalSpent.toLocaleString("en-US")} spent at auction
          </span>
        </div>
        {!board && token && draftId && (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => void downloadResults(token, draftId).then((err) => setDownloadError(err ?? ""))}
              className="h-11 rounded-ctl border border-line px-4 text-[15px] font-semibold"
            >
              Download CSV
            </button>
            {downloadError && (
              <span role="alert" className="text-sm font-semibold text-warn">
                {downloadError}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-1.5" role="tablist">
        {(["rosters", "log"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`h-10 flex-grow rounded-ctl text-sm font-bold sm:flex-grow-0 sm:px-6 ${tab === t ? "bg-text text-bg" : "border border-line font-semibold text-text"}`}
          >
            {t === "rosters" ? "Rosters & spend" : `Draft log (${log.length})`}
          </button>
        ))}
      </div>

      {tab === "rosters" && selected && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          <TeamsTable
            rows={rows}
            selectedId={selected.id}
            onSelect={(id) => {
              setChosenId(id);
              if (window.innerWidth < 1024) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
            }}
          />
          <TeamDetail snapshot={snapshot} team={selected} sectionRef={detailRef} />
        </div>
      )}

      {tab === "log" && (
        <ol className={`overflow-y-auto rounded-panel border border-line bg-surface ${board ? "max-h-[70vh]" : ""}`}>
          {log.map((e) => (
            <LogRow key={e.pickNo} e={e} />
          ))}
        </ol>
      )}

      {tab === "log" && snapshot.commishLog.length > 0 && (
        <section aria-labelledby="commish-changes" className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4">
          <h2 id="commish-changes" className="label">
            Commissioner changes
          </h2>
          <CommishLogList snapshot={snapshot} newestFirst={false} />
        </section>
      )}
      <p className="text-[13px] text-muted">
        Bids that were never revealed stay secret, even now. Only the amounts shown at each reveal appear here.
      </p>
    </div>
  );
}
