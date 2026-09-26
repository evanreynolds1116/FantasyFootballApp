import { useCountdown } from "../../lib/useCountdown";

/** "States every screen must handle": paused / break banner, all inputs disabled elsewhere while this is up. */
export function PausedBanner({ paused, breakEndsAt }: { paused: boolean; breakEndsAt: number | null }) {
  const { label } = useCountdown(breakEndsAt, false);
  if (!paused) return null;

  return (
    <div role="alert" className="rounded-panel border-2 border-warn-border bg-warn-bg px-5 py-4 text-warn font-semibold flex items-center justify-between">
      <span>{breakEndsAt ? "On a timed break" : "Draft paused"}</span>
      {breakEndsAt && <span className="font-display text-2xl font-extrabold">{label}</span>}
    </div>
  );
}
