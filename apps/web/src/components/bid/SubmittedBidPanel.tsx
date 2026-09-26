type Props = {
  amount: number | null;
  onChange: () => void;
  size: "phone" | "laptop";
};

export function SubmittedBidPanel({ amount, onChange, size }: Props) {
  const amountLabel = amount !== null ? `$${amount}` : "•••";

  if (size === "phone") {
    return (
      <div className="flex flex-grow flex-col items-stretch justify-center gap-3 rounded-panel border-2 border-success-border bg-success-bg p-5">
        <div className="flex items-center gap-2.5 text-base font-bold text-success">
          <CheckIcon />
          Your bid is in and hidden
        </div>
        <div className="font-display text-6xl font-extrabold leading-none">{amountLabel}</div>
        <div className="text-sm text-muted">No one sees amounts until the clock hits zero. You can change it until then.</div>
        <button
          type="button"
          onClick={onChange}
          className="h-12 rounded-ctl border border-success-border bg-transparent text-base font-semibold text-text"
        >
          Change bid
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6 rounded-panel border-2 border-success-border bg-success-bg px-7 py-6">
      <CheckIcon size={32} />
      <div className="flex flex-grow flex-col gap-0.5">
        <span className="text-base font-bold text-success">Your bid is in and hidden</span>
        <span className="font-display text-[52px] font-extrabold leading-none">{amountLabel}</span>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="h-[52px] rounded-ctl border border-success-border bg-transparent px-6 text-base font-semibold text-text"
      >
        Change bid
      </button>
    </div>
  );
}

function CheckIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#8FD6A8" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}
