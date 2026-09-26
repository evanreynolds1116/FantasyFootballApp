import type { DraftSnapshot } from "../../lib/contracts";
import { useAdminIntent } from "./useAdminIntent";

const OPTIONS: { value: number | "all"; label: string }[] = [
  { value: 1, label: "Winner only" },
  { value: 2, label: "Top 2" },
  { value: 3, label: "Top 3" },
  { value: 4, label: "Top 4" },
  { value: 5, label: "Top 5" },
  { value: "all", label: "All bids" },
];

/**
 * "Bids shown at reveal" — with clock lengths, the one setting SPEC lets the
 * commissioner change mid-draft. Applies from the next reveal; lots already
 * revealed keep what they showed (the engine records it per lot).
 */
export function RevealSettingPanel({ snapshot, disabled }: { snapshot: DraftSnapshot; disabled: boolean }) {
  const { send, busy, error } = useAdminIntent();
  const current = snapshot.settings.revealTopN;
  const known = OPTIONS.some((o) => o.value === current);

  return (
    <section aria-labelledby="reveal-setting" className="flex flex-col gap-2 rounded-[14px] bg-surface p-3.5">
      <div className="flex items-baseline justify-between">
        <h2 id="reveal-setting" className="label">
          Bids shown at reveal
        </h2>
        <span className="text-xs text-muted">From the next reveal</span>
      </div>
      <div role="radiogroup" aria-label="Bids shown at reveal" className="grid grid-cols-3 gap-1.5">
        {OPTIONS.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={current === o.value}
            disabled={disabled || busy}
            onClick={() => current !== o.value && void send("admin:setRevealTopN", { revealTopN: o.value })}
            className={`h-10 rounded-ctl text-sm font-semibold disabled:opacity-40 ${current === o.value ? "bg-text text-bg" : "border border-line"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {!known && <div className="text-[13px] text-muted">Currently: top {String(current)}.</div>}
      <div className="text-[13px] text-muted">The winner is always shown; other bids beyond this stay sealed forever. Everyone sees the change.</div>
      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}
    </section>
  );
}
