import { CLOCK_RANGES_SEC, validateSettings, type ClockName, type ClockSetting, type DraftSettings, type PositionGroup } from "@draft-app/engine";
import { useMemo, useState, type ReactNode } from "react";
import { summarizeRules } from "./ruleSummary";

/** Position groups as edited: positions kept as the raw text the commissioner is typing ("WR, TE"). */
type GroupDraft = { name: string; positionsText: string; min: number; max: number };

const toDraft = (g: PositionGroup): GroupDraft => ({ name: g.name, positionsText: g.positions.join(", "), min: g.min, max: g.max });
const fromDraft = (g: GroupDraft): PositionGroup => ({
  name: g.name.trim(),
  positions: g.positionsText
    .split(/[,/\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean),
  min: g.min,
  max: g.max,
});

const inputClass = "h-11 w-full rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent";
const numberValue = (n: number) => (Number.isNaN(n) ? "" : String(n));
const parseNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
      <legend className="label px-1">{title}</legend>
      {children}
    </fieldset>
  );
}

function NumberField({ label, value, onChange, hint, prefix }: { label: string; value: number; onChange: (n: number) => void; hint?: string; prefix?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-muted">
      {label}
      <span className="relative">
        {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text">{prefix}</span>}
        <input
          type="number"
          inputMode="numeric"
          value={numberValue(value)}
          onChange={(e) => onChange(parseNumber(e.target.value))}
          className={`${inputClass} ${prefix ? "pl-6" : ""}`}
        />
      </span>
      {hint && <span className="text-xs">{hint}</span>}
    </label>
  );
}

function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-muted">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex min-h-11 items-start gap-3 text-[15px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 flex-shrink-0 accent-[#F2B84B]" />
      <span className="flex flex-col">
        {label}
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

function ClockField({ label, clock, value, onChange }: { label: string; clock: ClockName; value: ClockSetting; onChange: (v: ClockSetting) => void }) {
  const { min, max } = CLOCK_RANGES_SEC[clock];
  const off = value === "off";
  return (
    <div className="flex flex-col gap-1 text-sm text-muted">
      <span>{label}</span>
      <div className="flex items-center gap-3">
        <span className="relative flex-grow">
          <input
            type="number"
            inputMode="numeric"
            aria-label={`${label} seconds`}
            disabled={off}
            value={off ? "" : numberValue(value)}
            onChange={(e) => onChange(parseNumber(e.target.value))}
            className={`${inputClass} pr-8 disabled:opacity-40`}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">s</span>
        </span>
        <label className="flex items-center gap-2 text-text">
          <input type="checkbox" checked={off} onChange={(e) => onChange(e.target.checked ? "off" : min)} className="h-5 w-5 accent-[#F2B84B]" />
          Off
        </label>
      </div>
      <span className="text-xs">
        {min}–{max} s
      </span>
    </div>
  );
}

/**
 * League settings form (SPEC's settings table), with SPEC's defaults
 * pre-filled on create. The engine's own validateSettings drives the error
 * list, so the form and the server can never disagree about what's allowed;
 * the server still re-checks on submit.
 */
export function SettingsForm({
  initialName,
  initialSettings,
  submitLabel,
  onSubmit,
  serverErrors,
}: {
  initialName: string;
  initialSettings: DraftSettings;
  submitLabel: string;
  onSubmit: (name: string, settings: DraftSettings) => Promise<void>;
  serverErrors: string[];
}) {
  const [name, setName] = useState(initialName);
  const [s, setS] = useState<DraftSettings>(initialSettings);
  const [groups, setGroups] = useState<GroupDraft[]>((initialSettings.positionGroups ?? []).map(toDraft));
  const [limitsOn, setLimitsOn] = useState(initialSettings.positionGroups !== null);
  const [submitting, setSubmitting] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);

  const set = <K extends keyof DraftSettings>(key: K, value: DraftSettings[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const settings: DraftSettings = useMemo(() => ({ ...s, positionGroups: limitsOn ? groups.map(fromDraft) : null }), [s, groups, limitsOn]);
  const issues = useMemo(() => validateSettings(settings).map((i) => i.message), [settings]);
  const nameIssue = name.trim() ? null : "Give the league a name.";
  const allIssues = [...(nameIssue ? [nameIssue] : []), ...issues];
  const summary = useMemo(() => (issues.length === 0 ? summarizeRules(settings) : null), [issues, settings]);
  const hasAuction = Number.isFinite(s.auctionSpots) && s.auctionSpots > 0;

  const updateGroup = (i: number, patch: Partial<GroupDraft>) => setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTriedSubmit(true);
    if (allIssues.length > 0) return;
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), settings);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-muted">
          League name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} />
        </label>

        <Section title="Teams & roster">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumberField label="Number of teams" value={s.teamCount} onChange={(n) => set("teamCount", n)} hint="2–20" />
            <NumberField label="Total roster size" value={s.rosterSize} onChange={(n) => set("rosterSize", n)} hint="1–30" />
            <NumberField label="Auction roster spots" value={s.auctionSpots} onChange={(n) => set("auctionSpots", n)} hint="0 = straight snake" />
          </div>
          <Toggle label="Position limits" checked={limitsOn} onChange={setLimitsOn} hint="Enforced on bids, picks and auto-picks." />
          {limitsOn && (
            <div className="flex flex-col gap-2">
              <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_64px_64px_40px] gap-2 text-xs text-muted sm:grid">
                <span>Group</span>
                <span>Positions</span>
                <span>Min</span>
                <span>Max</span>
                <span />
              </div>
              {groups.map((g, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2 rounded-ctl bg-surface-2 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_64px_64px_40px] sm:bg-transparent sm:p-0">
                  <input aria-label={`Group ${i + 1} name`} value={g.name} onChange={(e) => updateGroup(i, { name: e.target.value })} className={inputClass} />
                  <input
                    aria-label={`Group ${i + 1} positions`}
                    placeholder="WR, TE"
                    value={g.positionsText}
                    onChange={(e) => updateGroup(i, { positionsText: e.target.value })}
                    className={inputClass}
                  />
                  <input
                    aria-label={`${g.name || `Group ${i + 1}`} minimum`}
                    type="number"
                    value={numberValue(g.min)}
                    onChange={(e) => updateGroup(i, { min: parseNumber(e.target.value) })}
                    className={inputClass}
                  />
                  <input
                    aria-label={`${g.name || `Group ${i + 1}`} maximum`}
                    type="number"
                    value={numberValue(g.max)}
                    onChange={(e) => updateGroup(i, { max: parseNumber(e.target.value) })}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${g.name || `group ${i + 1}`}`}
                    onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))}
                    className="h-11 rounded-ctl border border-line text-lg text-muted"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setGroups((gs) => [...gs, { name: "", positionsText: "", min: 0, max: 1 }])}
                className="h-11 self-start rounded-ctl border border-line px-4 text-[15px] font-semibold"
              >
                + Add group
              </button>
            </div>
          )}
        </Section>

        <Section title="Money">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField label="Starting budget" prefix="$" value={s.startingBudget} onChange={(n) => set("startingBudget", n)} />
            <NumberField label="Minimum bid" prefix="$" value={s.minBid} onChange={(n) => set("minBid", n)} />
            <NumberField label="Bids in steps of" prefix="$" value={s.bidStep} onChange={(n) => set("bidStep", n)} />
            <NumberField label="Min tie raise" prefix="$" value={s.tieMinRaise} onChange={(n) => set("tieMinRaise", n)} />
          </div>
        </Section>

        <Section title="Clocks">
          <div className="grid grid-cols-2 gap-3">
            <ClockField label="Nomination" clock="nomination" value={s.nominationClockSec} onChange={(v) => set("nominationClockSec", v)} />
            <ClockField label="Bid" clock="bid" value={s.bidClockSec} onChange={(v) => set("bidClockSec", v)} />
            <ClockField label="Tie re-bid" clock="tie" value={s.tieClockSec} onChange={(v) => set("tieClockSec", v)} />
            <ClockField label="Snake pick" clock="pick" value={s.pickClockSec} onChange={(v) => set("pickClockSec", v)} />
          </div>
          <span className="text-xs text-muted">Clock lengths can also be changed mid-draft from the commissioner console.</span>
        </Section>

        {hasAuction && (
          <Section title="Auction rules">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Nomination order across rounds"
                value={s.nominationOrder}
                onChange={(v) => set("nominationOrder", v)}
                options={[
                  { value: "snake", label: "Snake (1 → N, then N → 1)" },
                  { value: "fixed", label: "Same order every round" },
                ]}
              />
              <SelectField
                label="If nobody bids"
                value={s.noBidAction}
                onChange={(v) => set("noBidAction", v)}
                options={[
                  { value: "awardNominator", label: "Nominator gets the player at the minimum" },
                  { value: "returnToPool", label: "Player goes back in the pool" },
                ]}
              />
              <SelectField
                label="Tie re-bid rounds"
                value={s.maxTieRounds === null ? "unlimited" : String(s.maxTieRounds)}
                onChange={(v) => set("maxTieRounds", v === "unlimited" ? null : Number(v))}
                options={[{ value: "unlimited", label: "Unlimited — keep re-bidding" }, ...Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `Up to ${i + 1}` }))]}
              />
              <SelectField
                label="Tie fallback"
                value={s.tieFallback}
                onChange={(v) => set("tieFallback", v)}
                options={[
                  { value: "randomDraw", label: "Random draw" },
                  { value: "commissionerDecides", label: "Commissioner decides" },
                  { value: "higherBudget", label: "Higher remaining budget" },
                  { value: "earlierTeamNumber", label: "Earlier team number" },
                ]}
              />
              <SelectField
                label="Bids shown at reveal"
                value={String(s.revealTopN)}
                onChange={(v) => set("revealTopN", v === "all" ? "all" : Number(v))}
                options={[
                  { value: "1", label: "Winner only" },
                  ...[2, 3, 4, 5].map((n) => ({ value: String(n), label: `Top ${n}` })),
                  { value: "all", label: "All bids" },
                ]}
              />
            </div>
            <Toggle label="Close bidding early when everyone has bid" checked={s.earlyClose} onChange={(v) => set("earlyClose", v)} hint="After a 3-second last call." />
            <Toggle
              label="Broke teams fill their auction spots at the end"
              checked={s.brokeTeamsFillAtEnd}
              onChange={(v) => set("brokeTeamsFillAtEnd", v)}
              hint="With make-up picks after the snake."
            />
          </Section>
        )}

        <Section title="Snake">
          <SelectField
            label="When the pick clock runs out"
            value={s.pickExpiryAction}
            onChange={(v) => set("pickExpiryAction", v)}
            options={[
              { value: "autoPick", label: "Auto-pick the best available player" },
              { value: "skip", label: "Skip them; they pick later" },
            ]}
          />
        </Section>
      </div>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-4">
        <div className="rounded-panel border border-line bg-surface p-4">
          <h2 className="label mb-2">Rules at a glance</h2>
          {summary ? (
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px]">
              {summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Fix the problems listed below to see the summary.</p>
          )}
        </div>
        {(triedSubmit || issues.length > 0) && allIssues.length > 0 && (
          <div role="alert" className="rounded-panel border border-warn-border bg-warn-bg p-4 text-sm text-warn">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {allIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        {serverErrors.length > 0 && (
          <div role="alert" className="rounded-panel border border-warn-border bg-warn-bg p-4 text-sm text-warn">
            {serverErrors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="h-14 rounded-panel bg-accent text-lg font-bold uppercase tracking-[0.04em] text-on-accent disabled:opacity-40"
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      </aside>
    </form>
  );
}
