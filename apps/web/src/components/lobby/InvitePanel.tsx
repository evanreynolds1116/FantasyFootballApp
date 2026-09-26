import { useState } from "react";
import { api, ApiError } from "../../lib/api";

/** The league's one reusable invite link. Any member can copy it; only the commissioner can replace it. */
export function InvitePanel({
  token,
  leagueId,
  inviteCode,
  isCommissioner,
  locked,
  onChanged,
}: {
  token: string;
  leagueId: string;
  inviteCode: string | null;
  isCommissioner: boolean;
  locked: boolean;
  onChanged: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmingNew, setConfirmingNew] = useState(false);
  const [error, setError] = useState("");
  const link = inviteCode ? `${window.location.origin}/join/${inviteCode}` : null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically — select the link and copy it.");
    }
  };

  const regenerate = async () => {
    setError("");
    try {
      await api(token, "POST", `/leagues/${leagueId}/invites`);
      setConfirmingNew(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not make a new link.");
    }
  };

  if (locked) return null;

  return (
    <section aria-labelledby="invite" className="flex flex-col gap-2.5 rounded-panel border border-line bg-surface p-4">
      <h2 id="invite" className="label">
        Invite link
      </h2>
      {link ? (
        <>
          <div className="flex gap-2">
            <input
              readOnly
              value={link}
              aria-label="Invite link"
              onFocus={(e) => e.target.select()}
              className="h-11 min-w-0 flex-grow rounded-ctl border border-line bg-surface-sunk px-3 text-sm text-text outline-none"
            />
            <button type="button" onClick={() => void copy()} className="h-11 w-24 flex-shrink-0 rounded-ctl bg-accent text-[15px] font-bold text-on-accent">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <span className="text-sm text-muted">
            Or share the code <strong className="tracking-[0.1em] text-text">{inviteCode}</strong>. Anyone with it can claim an open team.
          </span>
        </>
      ) : (
        <span className="text-sm text-muted">This league has no invite link yet.</span>
      )}
      {isCommissioner &&
        (confirmingNew ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-warn">The current link will stop working.</span>
            <button type="button" onClick={() => void regenerate()} className="h-10 rounded-ctl bg-warn px-3 font-bold text-on-accent">
              Make a new link
            </button>
            <button type="button" onClick={() => setConfirmingNew(false)} className="h-10 rounded-ctl border border-line px-3 font-semibold">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmingNew(true)} className="self-start text-sm font-semibold text-muted underline hover:text-text">
            {link ? "Replace this link" : "Make an invite link"}
          </button>
        ))}
      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}
    </section>
  );
}
