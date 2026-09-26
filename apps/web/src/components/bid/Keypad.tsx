const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "Del"] as const;

export function Keypad({ amount, onChange, disabled }: { amount: string; onChange: (next: string) => void; disabled: boolean }) {
  const press = (key: (typeof KEYS)[number]) => {
    if (key === "Clear") return onChange("");
    if (key === "Del") return onChange(amount.slice(0, -1));
    onChange((amount === "0" ? "" : amount) + key);
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          onClick={() => press(k)}
          aria-label={k === "Del" ? "Delete last digit" : k === "Clear" ? "Clear amount" : k}
          className="h-[52px] rounded-ctl bg-surface-2 text-2xl font-semibold disabled:opacity-40"
        >
          {k === "Del" ? "⌫" : k}
        </button>
      ))}
    </div>
  );
}
