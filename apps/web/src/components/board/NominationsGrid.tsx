import { useCountdown } from "../../lib/useCountdown";
import type { NominationSlot } from "../nominate/nominationData";

function OnClockCard({ slot, endsAt, remainingMs, paused }: { slot: NominationSlot; endsAt: number | null; remainingMs: number | null; paused: boolean }) {
  const { label, danger } = useCountdown(endsAt, paused, { remainingMs });
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-accent px-3.5 py-3 text-on-accent">
      <span className="text-[13px] font-extrabold tracking-[0.06em]">#{slot.order} · NOMINATING NOW</span>
      <span className="text-[19px] font-extrabold">Team {slot.team?.draftNumber ?? "?"}</span>
      <span className="truncate text-[15px] font-semibold">{slot.team?.name}</span>
      <span className={`text-[15px] font-semibold ${danger ? "text-[#7A1F0B]" : ""}`}>{label} left</span>
    </div>
  );
}

/**
 * Big board during nominations: one tile per team nominating this round, in
 * order — the player each has put up so far, the team on the clock, and the
 * teams still to come — so the room can see what's already been taken.
 */
export function NominationsGrid({
  round,
  slots,
  directionLabel,
  endsAt,
  remainingMs,
  paused,
}: {
  round: number;
  slots: NominationSlot[];
  directionLabel: string | null;
  endsAt: number | null;
  /** Time left on the nomination clock while paused, shown frozen. */
  remainingMs: number | null;
  paused: boolean;
}) {
  const nominatedCount = slots.filter((s) => s.kind === "nominated").length;
  return (
    <div className="flex min-h-0 flex-grow flex-col gap-2.5">
      <div className="flex justify-between text-xl">
        <span className="font-bold uppercase tracking-[0.06em] text-muted">
          Round {round} nominations{directionLabel ? ` · ${directionLabel}` : ""}
        </span>
        <span className="text-muted">
          {nominatedCount} of {slots.length} in
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        {slots.map((s) => {
          if (s.kind === "onClock") return <OnClockCard key={s.order} slot={s} endsAt={endsAt} remainingMs={remainingMs} paused={paused} />;
          if (s.kind === "nominated") {
            return (
              <div key={s.order} className="flex flex-col gap-0.5 rounded-xl bg-surface px-3.5 py-3">
                <span className="text-[13px] font-bold tracking-[0.06em] text-muted">
                  #{s.order} · TEAM {s.team?.draftNumber ?? "?"}
                </span>
                <span className="truncate text-[19px] font-bold">{s.player?.name ?? "—"}</span>
                <span className="text-[15px] text-muted">
                  {s.player?.position}
                  {s.player?.nflTeam ? ` · ${s.player.nflTeam}` : ""}
                </span>
              </div>
            );
          }
          return (
            <div key={s.order} className="flex flex-col gap-0.5 rounded-xl border-2 border-dashed border-line px-3.5 py-3 text-muted">
              <span className="text-[13px] font-bold tracking-[0.06em]">#{s.order} · UP LATER</span>
              <span className="text-[19px] font-bold">Team {s.team?.draftNumber ?? "?"}</span>
              <span className="truncate text-[15px]">{s.team?.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
