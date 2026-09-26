import { CLOCK_RANGES_SEC, type ClockName, type ClockSetting } from "@draft-app/engine";
import { useEffect, useRef, useState } from "react";
import type { DraftSnapshot } from "../../lib/contracts";
import { useAdminIntent } from "./useAdminIntent";

const STEP_SEC = 5;
/** Taps within this window are sent as one admin:setClocks, so tapping + five times makes one logged, announced change rather than five. */
const SEND_DELAY_MS = 700;

const ROWS: { clock: ClockName; label: string; ariaNoun: string; setting: keyof DraftSnapshot["settings"] }[] = [
  { clock: "nomination", label: "Nominate", ariaNoun: "nominate", setting: "nominationClockSec" },
  { clock: "bid", label: "Bid", ariaNoun: "bid", setting: "bidClockSec" },
  { clock: "tie", label: "Tie re-bid", ariaNoun: "tie", setting: "tieClockSec" },
  { clock: "pick", label: "Snake pick", ariaNoun: "pick", setting: "pickClockSec" },
];

/**
 * −/+ steppers for the four clock lengths. Changes apply from the next
 * nomination/lot/tie round/pick (SPEC: "the running clock is unchanged — use
 * +15 s"). The stepper stays within SPEC's range; a clock that's already
 * "off" shows Off and + turns it back on at the minimum.
 */
export function ClockLengthsPanel({ snapshot, disabled }: { snapshot: DraftSnapshot; disabled: boolean }) {
  const { send, error } = useAdminIntent();
  const [pending, setPending] = useState<Partial<Record<ClockName, ClockSetting>>>({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const flush = async () => {
    timer.current = null;
    const changes = pendingRef.current;
    if (Object.keys(changes).length === 0) return;
    await send("admin:setClocks", changes);
    // Success or failure, the next snapshot (or the unchanged one) is the
    // truth for what was sent — but keep any taps made while it was in flight.
    setPending((p) => {
      const rest = { ...p };
      for (const [clock, value] of Object.entries(changes)) {
        if (rest[clock as ClockName] === value) delete rest[clock as ClockName];
      }
      return rest;
    });
  };

  const step = (clock: ClockName, current: ClockSetting, direction: 1 | -1) => {
    const { min, max } = CLOCK_RANGES_SEC[clock];
    const next = current === "off" ? min : Math.min(max, Math.max(min, current + direction * STEP_SEC));
    if (next === current) return;
    setPending((p) => ({ ...p, [clock]: next }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SEND_DELAY_MS);
  };

  return (
    <section aria-labelledby="clock-lengths" className="flex flex-col gap-2 rounded-[14px] bg-surface p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 id="clock-lengths" className="label">
          Clock lengths
        </h2>
        <span className="text-xs text-muted">Apply from the next lot</span>
      </div>
      {ROWS.map(({ clock, label, ariaNoun, setting }) => {
        const saved = snapshot.settings[setting] as ClockSetting;
        const value = pending[clock] ?? saved;
        const { min, max } = CLOCK_RANGES_SEC[clock];
        const isPending = pending[clock] !== undefined && pending[clock] !== saved;
        return (
          <div key={clock} className="flex items-center justify-between text-base">
            <span>{label}</span>
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={`Shorter ${ariaNoun} clock`}
                disabled={disabled || value === "off" || value <= min}
                onClick={() => step(clock, value, -1)}
                className="h-9 w-11 rounded-lg bg-surface-2 text-lg disabled:opacity-40"
              >
                −
              </button>
              <strong aria-live="polite" className={`w-14 text-center ${isPending ? "text-accent" : ""}`}>
                {value === "off" ? "Off" : `${value} s`}
              </strong>
              <button
                type="button"
                aria-label={`Longer ${ariaNoun} clock`}
                disabled={disabled || (value !== "off" && value >= max)}
                onClick={() => step(clock, value, 1)}
                className="h-9 w-11 rounded-lg bg-surface-2 text-lg disabled:opacity-40"
              >
                +
              </button>
            </span>
          </div>
        );
      })}
      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}
    </section>
  );
}
