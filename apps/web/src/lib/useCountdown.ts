import { useEffect, useState } from "react";

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

/** Ticks off `endsAt` (an absolute server timestamp), frozen while paused. */
export function useCountdown(endsAt: number | null, paused: boolean): Countdown {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null || paused) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt, paused]);

  if (endsAt === null) return { secondsLeft: null, label: "--:--", danger: false };

  const msLeft = Math.max(0, endsAt - now);
  const secondsLeft = Math.ceil(msLeft / 1000);
  return { secondsLeft, label: format(secondsLeft), danger: secondsLeft <= 10 };
}
