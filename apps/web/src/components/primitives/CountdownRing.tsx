import { useEffect, useRef } from "react";
import { useCountdown } from "../../lib/useCountdown";

type Props = {
  endsAt: number | null;
  paused: boolean;
  /** Time left on a paused clock, shown frozen. */
  remainingMs?: number | null;
  /** The clock setting this ring represents, in seconds — used only to size the ring's fill, never the numeric label. */
  totalSeconds: number | null;
  sizePx: number;
  label: string;
};

/** A countdown ring + big digital time. Never the sole signal of urgency — the digits are always present too. */
export function CountdownRing({ endsAt, paused, remainingMs = null, totalSeconds, sizePx, label }: Props) {
  const { secondsLeft, label: timeLabel, danger } = useCountdown(endsAt, paused, { remainingMs });
  const announceRef = useRef<HTMLDivElement>(null);
  const lastAnnounced = useRef<number | null>(null);

  useEffect(() => {
    if (secondsLeft === null) return;
    const threshold = secondsLeft <= 10 ? 10 : secondsLeft <= 30 ? 30 : null;
    if (threshold !== null && lastAnnounced.current !== threshold && announceRef.current) {
      announceRef.current.textContent = `${threshold} seconds left`;
      lastAnnounced.current = threshold;
    }
  }, [secondsLeft]);

  const radius = sizePx / 2 - sizePx * 0.073;
  const circumference = 2 * Math.PI * radius;
  const ratio = totalSeconds && secondsLeft !== null ? Math.min(1, Math.max(0, secondsLeft / totalSeconds)) : 1;
  const dashOffset = circumference * (1 - ratio);
  const stroke = danger ? "#FF9A7A" : "#F2B84B";
  const center = sizePx / 2;
  const strokeWidth = Math.max(6, sizePx * 0.07);

  return (
    <div className="relative flex-shrink-0" style={{ width: sizePx, height: sizePx }}>
      <svg width={sizePx} height={sizePx} viewBox={`0 0 ${sizePx} ${sizePx}`} aria-hidden="true">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#2C3D31" strokeWidth={strokeWidth} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div
        className="font-display absolute inset-0 flex items-center justify-center font-extrabold"
        style={{ fontSize: sizePx * 0.35, color: danger ? "#FF9A7A" : undefined }}
        aria-label={`${label}: ${timeLabel}`}
      >
        {timeLabel}
      </div>
      <div ref={announceRef} aria-live="polite" className="sr-only" />
    </div>
  );
}
