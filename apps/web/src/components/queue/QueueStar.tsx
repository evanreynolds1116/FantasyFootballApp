/** Add to / remove from your queue — a star, with a label for screen readers and a visible "Queue" word on wider rows. */
export function QueueStar({ queued, onToggle, name, disabled = false }: { queued: boolean; onToggle: () => void; name: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={queued}
      aria-label={queued ? `Remove ${name} from your queue` : `Add ${name} to your queue`}
      title={queued ? "In your queue — tap to remove" : "Add to your queue"}
      disabled={disabled}
      onClick={onToggle}
      className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-ctl text-xl disabled:opacity-40 ${
        queued ? "bg-chip text-accent" : "border border-line text-muted hover:text-text"
      }`}
    >
      {queued ? "★" : "☆"}
    </button>
  );
}
