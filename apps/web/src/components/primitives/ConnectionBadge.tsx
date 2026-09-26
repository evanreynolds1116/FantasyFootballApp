import type { ConnectionStatus } from "../../store/DraftProvider";

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  if (status === "connected") {
    return (
      <span title="Connected" className="flex items-center gap-1.5 text-sm text-success">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="5" fill="#8FD6A8" />
        </svg>
        {/* Just the dot on narrow phones, where the header is full; problems below always spell themselves out. */}
        <span className="sr-only sm:not-sr-only">Connected</span>
      </span>
    );
  }
  return (
    <span role="status" className="flex items-center gap-1.5 text-sm text-warn">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <circle cx="5" cy="5" r="5" fill="#FF9A7A" />
      </svg>
      {status === "reconnecting" ? "Reconnecting…" : "Connecting…"}
    </span>
  );
}
