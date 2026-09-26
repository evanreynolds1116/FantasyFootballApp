import { useEffect, useState } from "react";
import { useClockHold } from "../store/DraftProvider";

export type Countdown = {
  secondsLeft: number | null;
  label: string;
  /** Last 10 seconds (UI.md: clock turns warn color). */
  danger: boolean;
};

function format(secondsLeft: number): string {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Ticks off `endsAt` (an absolute server timestamp), frozen while paused and
 * held during the 10-second "back in" countdown after a Resume and while a
 * reveal plays (the server already pushed every clock back by them). `ignoreHold` is for countdowns that
 * aren't draft clocks — the break, the reveal, the back-in countdown itself.
 * `remainingMs` is what a paused clock had left (pausing clears `endsAt` and
 * stores it there): shown frozen instead of "--:--".
 */
export function useCountdown(
  endsAt: number | null,
  paused: boolean,
  { ignoreHold = false, remainingMs = null }: { ignoreHold?: boolean; remainingMs?: number | null } = {},
): Countdown {
  const [now, setNow] = useState(() => Date.now());
  const hold = useClockHold();

  useEffect(() => {
    if (endsAt === null || paused) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt, paused]);

  if (endsAt === null) {
    if (remainingMs === null) return { secondsLeft: null, label: "--:--", danger: false };
    const frozen = Math.max(0, Math.ceil(remainingMs / 1000));
    return { secondsLeft: frozen, label: format(frozen), danger: frozen <= 10 };
  }

  const from = ignoreHold || hold === null ? now : Math.max(now, hold);
  const msLeft = Math.max(0, endsAt - from);
  const secondsLeft = Math.ceil(msLeft / 1000);
  return { secondsLeft, label: format(secondsLeft), danger: secondsLeft <= 10 };
}
