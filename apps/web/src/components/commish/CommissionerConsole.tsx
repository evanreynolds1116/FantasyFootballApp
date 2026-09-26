import { currentLot } from "@draft-app/engine";
import { useCountdown } from "../../lib/useCountdown";
import { useDraft } from "../../store/DraftProvider";
import { asEngineState } from "../../store/selectors";
import { ClockLengthsPanel } from "./ClockLengthsPanel";
import { ConnectedTeamsPanel } from "./ConnectedTeamsPanel";
import { ResolveTiePanel } from "./ResolveTiePanel";
import { UndoButton } from "./UndoButton";
import { activeClock, phaseSummary } from "./consoleText";
import { useAdminIntent } from "./useAdminIntent";

const BREAK_MINUTES = [5, 10, 15, 30];
const ADD_TIME_SEC = 15;

function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5z" />
    </svg>
  );
}

/**
 * Commissioner console (UI.md §6, Commish mockup). Every control here is a
 * draft-wide admin intent — there is deliberately no way to nominate, bid or
 * pick for any team, and no sealed amount is ever available to show: the
 * snapshot this reads is the same bid-scrubbed one every manager gets.
 */
export function CommissionerConsole() {
  const { snapshot, status } = useDraft();
  const pauseIntent = useAdminIntent();
  const timeIntent = useAdminIntent();
  const breakIntent = useAdminIntent();
  const startIntent = useAdminIntent();

  const clock = snapshot ? activeClock(snapshot) : { endsAt: null, remainingMs: null };
  const { label: runningLabel } = useCountdown(clock.endsAt, snapshot?.paused ?? false);

  if (!snapshot) return <div className="flex flex-grow items-center justify-center text-muted">Loading draft…</div>;

  // Inputs lock until the server is reachable again (UI.md "Reconnecting").
  const offline = status !== "connected";
  const lot = currentLot(asEngineState(snapshot));
  const clockLabel = clock.endsAt !== null ? runningLabel : clock.remainingMs !== null ? formatMs(clock.remainingMs) : null;
  const canAddTime = !snapshot.paused && clock.endsAt !== null;
  const needsTieCall = lot?.state === "fallback" && snapshot.settings.tieFallback === "commissionerDecides";
  const live = snapshot.phase !== "setup" && snapshot.phase !== "complete";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-grow flex-col gap-3.5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[26px] font-extrabold uppercase">Commissioner</h1>
        <span className="text-right text-[13px] text-muted">
          {phaseSummary(snapshot)}
          {clockLabel && (
            <>
              {" · "}
              <span aria-label={`Clock ${clockLabel}${snapshot.paused ? ", frozen" : ""}`}>{clockLabel}</span>
            </>
          )}
        </span>
      </div>

      {snapshot.phase === "setup" && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            disabled={offline || startIntent.busy}
            onClick={() => void startIntent.send("admin:start")}
            className="h-16 rounded-[14px] bg-accent text-lg font-bold text-on-accent disabled:opacity-40"
          >
            Start the draft
          </button>
          {startIntent.error && (
            <div role="alert" className="text-sm font-semibold text-warn">
              {startIntent.error}
            </div>
          )}
        </div>
      )}

      {live && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={offline || pauseIntent.busy}
              onClick={() => void pauseIntent.send(snapshot.paused ? "admin:resume" : "admin:pause")}
              className="flex h-16 items-center justify-center gap-2 rounded-[14px] bg-accent text-lg font-bold text-on-accent disabled:opacity-40"
            >
              {snapshot.paused ? <PlayIcon /> : <PauseIcon />}
              {snapshot.paused ? "Resume" : "Pause now"}
            </button>
            <button
              type="button"
              disabled={offline || timeIntent.busy || !canAddTime}
              onClick={() => void timeIntent.send("admin:addTime", { seconds: ADD_TIME_SEC })}
              className="h-16 rounded-[14px] border border-line bg-surface text-lg font-bold disabled:opacity-40"
            >
              +{ADD_TIME_SEC} seconds
            </button>
          </div>
          {(pauseIntent.error || timeIntent.error) && (
            <div role="alert" className="text-sm font-semibold text-warn">
              {pauseIntent.error || timeIntent.error}
            </div>
          )}

          {needsTieCall && lot && <ResolveTiePanel snapshot={snapshot} lot={lot} disabled={offline} />}

          <section aria-labelledby="timed-break" className="flex flex-col gap-2 rounded-[14px] bg-surface p-3.5">
            <h2 id="timed-break" className="label">
              Timed break
            </h2>
            <div className="grid grid-cols-4 gap-1.5">
              {BREAK_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  disabled={offline || breakIntent.busy}
                  onClick={() => void breakIntent.send("admin:break", { minutes })}
                  className="h-11 rounded-ctl border border-line text-[15px] font-semibold disabled:opacity-40"
                >
                  {minutes} min
                </button>
              ))}
            </div>
            <div className="text-[13px] text-muted">Shows a countdown everywhere. Draft resumes only when you tap Resume.</div>
            {breakIntent.error && (
              <div role="alert" className="text-sm font-semibold text-warn">
                {breakIntent.error}
              </div>
            )}
          </section>
        </>
      )}

      {snapshot.phase !== "complete" && <ClockLengthsPanel snapshot={snapshot} disabled={offline} />}

      {snapshot.phase !== "setup" && <UndoButton snapshot={snapshot} disabled={offline} />}

      <ConnectedTeamsPanel snapshot={snapshot} />
    </div>
  );
}
