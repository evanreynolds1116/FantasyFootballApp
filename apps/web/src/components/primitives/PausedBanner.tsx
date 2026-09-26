import { useCountdown } from "../../lib/useCountdown";
import { useResumeHold } from "../../store/DraftProvider";

/**
 * "States every screen must handle": paused / break banner, all inputs
 * disabled elsewhere while this is up. After a Resume it becomes the
 * 10-second "back in" countdown (SPEC), while every clock holds.
 */
export function PausedBanner({ paused, breakEndsAt }: { paused: boolean; breakEndsAt: number | null }) {
  const { label } = useCountdown(breakEndsAt, false, { ignoreHold: true });
  const hold = useResumeHold();
  const backIn = useCountdown(paused ? null : hold, false, { ignoreHold: true });

  if (!paused) {
    if (!backIn.secondsLeft) return null;
    return (
      <div role="status" className="flex items-center justify-between rounded-panel bg-accent px-5 py-4 font-semibold text-on-accent">
        <span>Back in… clocks start after the countdown</span>
        <span className="font-display text-2xl font-extrabold">{Math.min(10, backIn.secondsLeft)}</span>
      </div>
    );
  }

  return (
    <div role="alert" className="rounded-panel border-2 border-warn-border bg-warn-bg px-5 py-4 text-warn font-semibold flex items-center justify-between">
      <span>{breakEndsAt ? "On a timed break" : "Draft paused"}</span>
      {breakEndsAt && <span className="font-display text-2xl font-extrabold">{label}</span>}
    </div>
  );
}
