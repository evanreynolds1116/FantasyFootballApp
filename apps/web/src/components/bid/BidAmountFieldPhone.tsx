import type { BidForm } from "./useBidForm";
import { Keypad } from "./Keypad";

export function BidAmountFieldPhone({ form, minBid, budget, disabled, disabledReason }: { form: BidForm; minBid: number; budget: number; disabled: boolean; disabledReason?: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between rounded-panel border-2 border-accent bg-surface-sunk px-4 py-2">
        <span aria-live="polite" className="font-display text-5xl font-extrabold">
          ${form.amount === "" ? "0" : form.amount}
        </span>
        <span className="text-[13px] text-muted">
          Min ${minBid} · max ${budget}
        </span>
      </div>
      {form.previousBidStands && (
        <div className="text-sm text-muted">Your previous bid stays in if you don&apos;t submit a new one before the clock ends.</div>
      )}
      {form.error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {form.error}
        </div>
      )}
      {disabled && disabledReason && (
        <div className="text-sm font-semibold text-warn">{disabledReason}</div>
      )}
      <Keypad amount={form.amount} onChange={form.setAmount} disabled={disabled} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => void form.submit()}
        className="h-14 rounded-panel bg-accent text-lg font-bold uppercase tracking-[0.04em] text-on-accent disabled:opacity-40"
      >
        Lock in sealed bid
      </button>
    </div>
  );
}
