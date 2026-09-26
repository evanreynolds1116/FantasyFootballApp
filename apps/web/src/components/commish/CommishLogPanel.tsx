import type { DraftSnapshot } from "../../lib/contracts";
import { editText } from "./editText";

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Every commissioner edit, with its time — the console shows newest first, the results screen in order. */
export function CommishLogList({ snapshot, newestFirst = true }: { snapshot: DraftSnapshot; newestFirst?: boolean }) {
  const edits = newestFirst ? [...snapshot.commishLog].reverse() : snapshot.commishLog;
  if (edits.length === 0) return <div className="text-sm text-muted">No changes yet.</div>;
  return (
    <ol className="flex flex-col gap-1">
      {edits.map((edit) => (
        <li key={edit.id} className="flex items-baseline gap-2 text-sm">
          <span className="w-16 flex-shrink-0 text-muted">{time(edit.at)}</span>
          <span>{editText(edit, snapshot)}</span>
        </li>
      ))}
    </ol>
  );
}

export function CommishLogPanel({ snapshot }: { snapshot: DraftSnapshot }) {
  return (
    <section aria-labelledby="commish-log" className="flex flex-col gap-2 rounded-[14px] bg-surface p-3.5">
      <h2 id="commish-log" className="label">
        Your changes
      </h2>
      <CommishLogList snapshot={snapshot} />
    </section>
  );
}
