import type { BidForm } from "./useBidForm";

export function BidAmountFieldLaptop({ form, minBid, budget, disabled, disabledReason }: { form: BidForm; minBid: number; budget: number; disabled: boolean; disabledReason?: string }) {
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.submit();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5 rounded-panel border border-line bg-surface px-7 py-6">
      <label htmlFor="bid-amount" className="text-[15px] text-muted">
        Your sealed bid · min ${minBid} · you can spend up to <strong className="text-text">${budget}</strong>
      </label>
      {/* Field on its own row and the buttons beneath: the middle column is only ~400px wide on a 1280px laptop, too narrow for all three side by side. */}
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 items-center gap-1 rounded-panel border-2 border-accent bg-surface-sunk px-5">
          <span className="font-display text-[44px] font-extrabold text-muted">$</span>
          <input
            id="bid-amount"
            inputMode="numeric"
            autoComplete="off"
            value={form.amount}
            onChange={(e) => form.setAmount(e.target.value)}
            placeholder="0"
            disabled={disabled}
            className="font-display h-[72px] min-w-0 flex-grow border-0 bg-transparent text-[48px] font-extrabold text-text outline-none disabled:opacity-40"
          />
        </div>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
          <button
            type="submit"
            disabled={disabled}
            className="h-14 rounded-panel bg-accent text-lg font-bold uppercase tracking-[0.04em] text-on-accent disabled:opacity-40"
          >
            Lock in bid
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void form.pass()}
            title="Lock in without bidding so the lot can close sooner. Nobody can tell a pass from a bid."
            className="h-14 rounded-panel border border-line text-lg font-bold uppercase tracking-[0.04em] disabled:opacity-40"
          >
            Pass
          </button>
        </div>
      </div>
      <div className="flex justify-between text-sm text-muted">
        <span>
          Type an amount and press <kbd className="rounded-[5px] border border-line-dashed px-1.5 py-px text-xs">Enter</kbd>
        </span>
        {form.error && (
          <span role="alert" className="font-semibold text-warn">
            {form.error}
          </span>
        )}
        {!form.error && form.previousBidStands && (
          <span>Your previous {form.lockedIn === "pass" ? "pass" : "bid"} stays in if you don&apos;t submit a new one before the clock ends.</span>
        )}
        {!form.error && !form.previousBidStands && disabled && disabledReason && <span className="font-semibold text-warn">{disabledReason}</span>}
      </div>
    </form>
  );
}
