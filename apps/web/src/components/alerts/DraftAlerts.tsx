import { useEffect, useRef, useState } from "react";
import { useClockHold, useDraft } from "../../store/DraftProvider";
import { canVibrate, fireCue, loadPrefs, savePrefs, unlockAudio, type AlertPrefs } from "./cues";
import { myTurn } from "./myTurn";

const WARNING_MS = 10_000;

/**
 * Plays FR-20's cues from the live snapshot: "you're on the clock" when a
 * nomination, tie re-bid or pick turn becomes yours, and a 10-second warning
 * while you still haven't acted (bids included). Reveal cues belong to the
 * reveal screen's show. Purely client-side — it only reacts to state the
 * server already sent.
 */
function useDraftAlerts(prefs: AlertPrefs) {
  const { snapshot } = useDraft();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const turn = snapshot ? myTurn(snapshot) : null;
  const paused = snapshot?.paused ?? false;
  const hold = useClockHold();

  // Audio can only start after a gesture; the first tap or key anywhere unlocks it.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const lastTurnKey = useRef<string | null>(null);
  useEffect(() => {
    const key = turn?.key ?? null;
    if (key === lastTurnKey.current) return;
    lastTurnKey.current = key;
    if (turn && turn.kind !== "bid") fireCue("turn", prefsRef.current);
  }, [turn]);

  // Warn once per turn, and only if we saw the clock above 10 s first — a turn
  // that starts inside the last 10 seconds already got the "turn" cue.
  const turnKey = turn?.key ?? null;
  const endsAt = turn?.endsAt ?? null;
  const armed = useRef<{ key: string; warned: boolean } | null>(null);
  useEffect(() => {
    if (turnKey === null || endsAt === null || paused) return;
    const check = () => {
      // During a back-in countdown or a reveal the clock hasn't started, so time left is measured from its end.
      const left = endsAt - Math.max(Date.now(), hold ?? 0);
      if (armed.current?.key !== turnKey) armed.current = { key: turnKey, warned: left <= WARNING_MS };
      if (!armed.current.warned && left <= WARNING_MS && left > 0) {
        armed.current.warned = true;
        fireCue("warning", prefsRef.current);
      }
    };
    check();
    const id = setInterval(check, 250);
    return () => clearInterval(id);
  }, [turnKey, endsAt, paused, hold]);

  // Reveal sounds (drumroll, flips, the win) are played by RevealScreen, in step with its show.
}

function BellIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      {muted && <path d="M3 3l18 18" />}
    </svg>
  );
}

/** Header control: runs the alerts and lets each person turn sound and vibration on or off (remembered on this device). */
export function DraftAlerts() {
  const [prefs, setPrefs] = useState<AlertPrefs>(loadPrefs);
  const [open, setOpen] = useState(false);
  useDraftAlerts(prefs);
  const vibrateSupported = canVibrate();
  const muted = !prefs.sound && !(vibrateSupported && prefs.vibrate);

  const update = (next: AlertPrefs) => {
    setPrefs(next);
    savePrefs(next);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className="relative">
      <button
        type="button"
        aria-label={muted ? "Alerts are off — sound and vibration settings" : "Sound and vibration settings"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 w-9 items-center justify-center rounded-lg ${muted ? "text-muted" : "text-text"} hover:bg-surface-2`}
      >
        <BellIcon muted={muted} />
      </button>
      {open && (
        <div role="dialog" aria-label="Alerts" className="absolute right-0 top-11 z-20 flex w-64 flex-col gap-3 rounded-panel border border-line bg-surface p-4 shadow-lg">
          <span className="label">Alerts</span>
          <p className="text-[13px] text-muted">When you&apos;re on the clock, with 10 seconds left, and when bids are revealed.</p>
          <label className="flex items-center justify-between gap-3 text-[15px] font-semibold">
            Sounds
            <input type="checkbox" checked={prefs.sound} onChange={(e) => update({ ...prefs, sound: e.target.checked })} className="h-5 w-5 accent-accent" />
          </label>
          {vibrateSupported ? (
            <label className="flex items-center justify-between gap-3 text-[15px] font-semibold">
              Vibration
              <input type="checkbox" checked={prefs.vibrate} onChange={(e) => update({ ...prefs, vibrate: e.target.checked })} className="h-5 w-5 accent-accent" />
            </label>
          ) : (
            <span className="text-[13px] text-muted">This device doesn&apos;t support vibration.</span>
          )}
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              fireCue("turn", prefs);
            }}
            className="h-10 rounded-ctl border border-line text-sm font-semibold"
          >
            Test
          </button>
        </div>
      )}
    </span>
  );
}
