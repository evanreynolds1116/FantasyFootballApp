import { availablePlayerIds, nominationOrderForRound, teamsByDraftNumber } from "@draft-app/engine";
import { useState } from "react";
import { useCountdown } from "../../lib/useCountdown";
import { emitIntent } from "../../lib/socket";
import { useDraft } from "../../store/DraftProvider";
import { asEngineState } from "../../store/selectors";
import { nominationSlots, unavailableReason, type NominationSlot } from "./nominationData";

const POSITION_PILLS = ["All", "QB", "RB", "WR/TE", "K", "DEF"] as const;
type PositionPill = (typeof POSITION_PILLS)[number];

function matchesPill(position: string, pill: PositionPill): boolean {
  if (pill === "All") return true;
  if (pill === "WR/TE") return position === "WR" || position === "TE";
  return position === pill;
}

/**
 * This round's nominations, near the top so the team on the clock sees
 * what's already been put up before searching. Nominated players are listed
 * one per line; the teams still to come collapse into one line.
 */
function RoundNominations({ slots, directionLabel, myTeamId }: { slots: NominationSlot[]; directionLabel: string | null; myTeamId: string | null }) {
  const nominated = slots.filter((s) => s.kind === "nominated");
  const onClock = slots.find((s) => s.kind === "onClock");
  const upcoming = slots.filter((s) => s.kind === "upcoming");
  const label = (s: NominationSlot) => (s.team?.id === myTeamId ? "you" : `Team ${s.team?.draftNumber ?? "?"}`);

  return (
    <section aria-labelledby="round-noms" className="flex flex-col gap-1.5 rounded-[14px] bg-surface px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <h2 id="round-noms" className="label">
          Nominated this round{directionLabel ? ` · ${directionLabel}` : ""}
        </h2>
        <span className="text-[13px] text-muted">
          {nominated.length} of {slots.length}
        </span>
      </div>
      {nominated.length === 0 && <div className="text-sm text-muted">Nobody has nominated yet.</div>}
      <ol className="flex flex-col gap-1">
        {nominated.map((s) => (
          <li key={s.order} className="flex items-baseline justify-between gap-3 text-[15px]">
            <span className="min-w-0 truncate">
              <span className="text-muted">{s.order}.</span> <span className="font-semibold">{s.kind === "nominated" ? s.player?.name : ""}</span>
              <span className="text-muted"> · {s.kind === "nominated" ? s.player?.position : ""}</span>
            </span>
            <span className="flex-shrink-0 text-sm text-muted">{label(s)}</span>
          </li>
        ))}
      </ol>
      {(onClock || upcoming.length > 0) && (
        <div className="text-sm text-muted">
          {onClock && (
            <>
              <span className="font-semibold text-accent">{onClock.order}. {label(onClock) === "you" ? "You're" : `${label(onClock)} is`} nominating now</span>
              {upcoming.length > 0 && " · "}
            </>
          )}
          {upcoming.length > 0 && `then ${upcoming.map(label).join(", ")}`}
        </div>
      )}
    </section>
  );
}

export function NominateScreen() {
  const { snapshot, socket } = useDraft();
  const [search, setSearch] = useState("");
  const [pill, setPill] = useState<PositionPill>("All");
  const [error, setError] = useState("");
  const { label: clockLabel } = useCountdown(snapshot?.nominationEndsAt ?? null, snapshot?.paused ?? false);

  if (!snapshot) return null;
  const state = asEngineState(snapshot);
  const myTeamId = snapshot.myTeamId;
  const onTheClock = snapshot.nominationTurnTeamId !== null && snapshot.nominationTurnTeamId === myTeamId;
  const clockTeam = snapshot.teams.find((t) => t.id === snapshot.nominationTurnTeamId);

  const round = snapshot.auctionRound;
  const slots = nominationSlots(state);
  const order = nominationOrderForRound(snapshot.settings, teamsByDraftNumber(snapshot.teams), round);
  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));
  const directionLabel =
    order.length > 1 ? `${teamById.get(order[0]!)?.draftNumber} → ${teamById.get(order[order.length - 1]!)?.draftNumber}` : null;

  const q = search.trim().toLowerCase();
  const matchesSearch = (p: { name: string; nflTeam?: string }) => !q || p.name.toLowerCase().includes(q) || (p.nflTeam ?? "").toLowerCase().includes(q);
  const availableIds = new Set(availablePlayerIds(state));
  const available = snapshot.players.filter((p) => availableIds.has(p.id) && matchesPill(p.position, pill) && matchesSearch(p));
  // While searching, players who match but can't be nominated are listed with the reason, instead of silently missing.
  const taken = q ? snapshot.players.filter((p) => !availableIds.has(p.id) && matchesPill(p.position, pill) && matchesSearch(p)) : [];

  const nominate = async (playerId: string) => {
    setError("");
    const ack = await emitIntent(socket, "nominate", { playerId });
    if (!ack.ok) setError(ack.message);
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-grow flex-col gap-3.5 py-2">
      <div className="flex justify-between text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
        <span>Round {round} · Nominations</span>
      </div>

      {onTheClock ? (
        <div className="flex items-center justify-between rounded-panel bg-accent px-4 py-4 text-on-accent">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-bold uppercase tracking-[0.08em]">You&apos;re on the clock</span>
            <span className="text-[15px] font-medium">Put one player up for auction</span>
          </div>
          <span className="font-display text-4xl font-extrabold">{clockLabel}</span>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-panel border border-line bg-surface px-4 py-4 text-[15px] text-muted">
          <span>Team {clockTeam?.draftNumber ?? "?"} is nominating…</span>
          <span className="font-display text-2xl font-extrabold text-text">{clockLabel}</span>
        </div>
      )}

      <RoundNominations slots={slots} directionLabel={directionLabel} myTeamId={myTeamId} />

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Search available players</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name or NFL team"
          className="h-12 rounded-ctl border border-line bg-surface px-3.5 text-base text-text outline-none focus:border-accent"
        />
      </label>

      <div className="flex flex-wrap gap-1.5">
        {POSITION_PILLS.map((p) => {
          const active = pill === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              onClick={() => setPill(p)}
              className={`h-9 rounded-full px-3 text-sm font-semibold ${active ? "bg-text text-bg" : "border border-line bg-transparent text-text"}`}
            >
              {p}
            </button>
          );
        })}
      </div>

      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}

      <div className="flex flex-col overflow-hidden rounded-[14px] border border-line">
        {available.length === 0 && taken.length === 0 && <div className="px-4 py-4 text-sm text-muted">No players match.</div>}
        {available.map((p, i) => (
          <div key={p.id} className={`flex items-center gap-3 bg-surface px-3.5 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
            <span className="w-11 text-xs font-bold text-accent">{p.position}</span>
            <div className="flex min-w-0 flex-grow flex-col">
              <span className="text-base font-semibold">{p.name}</span>
              <span className="text-[13px] text-muted">
                {p.nflTeam}
                {p.byeWeek ? ` · Bye ${p.byeWeek}` : ""}
              </span>
            </div>
            <button
              type="button"
              disabled={!onTheClock}
              onClick={() => void nominate(p.id)}
              className="h-11 rounded-ctl bg-accent px-3.5 text-sm font-bold text-on-accent disabled:opacity-40"
            >
              Nominate
            </button>
          </div>
        ))}
        {taken.map((p, i) => (
          <div key={p.id} className={`flex items-center gap-3 bg-[#131B16] px-3.5 py-3 ${available.length > 0 || i > 0 ? "border-t border-line" : ""}`}>
            <span className="w-11 text-xs font-bold text-[#7F8E82]">{p.position}</span>
            <div className="flex min-w-0 flex-grow flex-col">
              <span className="text-base font-semibold text-muted">{p.name}</span>
              <span className="text-[13px] text-muted">{unavailableReason(state, p.id)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
