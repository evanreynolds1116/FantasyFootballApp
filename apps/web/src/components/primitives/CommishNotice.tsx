import { useDraft } from "../../store/DraftProvider";
import { editText } from "../commish/editText";

/** Tells the whole league about a commissioner edit as it happens (a voided lot, an injury, a roster or budget fix). */
export function CommishNotice({ size = "phone" }: { size?: "phone" | "board" }) {
  const { notice, snapshot } = useDraft();
  if (!notice || !snapshot) return null;
  return (
    <div
      role="status"
      className={`flex items-baseline gap-3 rounded-panel border border-line bg-surface-2 font-semibold ${size === "board" ? "px-6 py-4 text-2xl" : "px-4 py-3 text-[15px]"}`}
    >
      <span className={`flex-shrink-0 font-bold uppercase tracking-[0.06em] text-accent ${size === "board" ? "text-lg" : "text-[12px]"}`}>Commissioner</span>
      <span className="min-w-0">{editText(notice, snapshot)}</span>
    </div>
  );
}
