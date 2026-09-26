import { Link } from "react-router-dom";

/** Shown instead of an endless "Loading…" when a draft link points at a draft that doesn't exist. */
export function DraftNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-4 text-center text-text">
      <span className="font-display text-3xl font-extrabold uppercase">Draft not found</span>
      <span className="max-w-sm text-muted">Check the link — it should end with the draft&apos;s full id, as copied from the app.</span>
      <Link to="/" className="font-semibold text-accent underline">
        Go to your leagues
      </Link>
    </div>
  );
}
