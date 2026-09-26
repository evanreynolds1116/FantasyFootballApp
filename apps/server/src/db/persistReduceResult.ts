import type { Action, DraftState, ReduceResult } from "@draft-app/engine";
import { sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { extractBookkeeping } from "./engineState.js";
import { bidToRow, lotToRow, pickToRow } from "./mappers.js";

/** A reduce() call that only produced a draft:rejected event never changed state — nothing to persist. */
export function wasRejected(result: ReduceResult): boolean {
  return result.events.length === 1 && result.events[0]?.type === "draft:rejected";
}

function currentLotId(state: DraftState): string | null {
  const terminal = new Set(["awarded", "returnedToPool", "cancelled"]);
  return state.lots.find((l) => !terminal.has(l.state))?.id ?? null;
}

/** A mapper row as JSON for jsonb_to_recordset: snake_case keys, timestamps as ISO strings. */
function jsonRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

/**
 * Diffs prevState vs result.state and writes the whole change as ONE SQL
 * statement: lots/bids upserted by id, picks inserted/deleted, the draft
 * row's scalar columns + engine_state + version rewritten, one audit_event
 * appended. Diffing uses reference (in)equality — the engine's
 * immutable-update style means an untouched array element keeps the exact
 * same object reference.
 *
 * Why one statement: every intent is persisted before it's broadcast, under
 * a per-draft mutex, so persistence latency is ack latency — and with a
 * remote database each round trip counts. postgres.js needs two round trips
 * per parameterised statement and can't pipeline them, so the old
 * transaction of 5–8 statements cost 8+ round trips. Here the changes travel
 * as a single jsonb parameter and data-modifying CTEs apply them: one
 * statement is atomic on its own (no BEGIN/COMMIT), and it costs two round
 * trips in total.
 *
 * Row order within each upsert follows the arrays below (the engine's lot
 * order), so a lot closing is written before the next one opening, as the
 * one-open-lot-per-draft partial unique index requires. Foreign-key checks
 * run at the end of the statement. The audit row numbers itself from
 * max(seq) + 1, which is safe because the runtime's mutex serializes
 * writers — and the (draft_id, seq) unique index would reject a duplicate
 * if that ever changed.
 */
export async function persistReduceResult(
  db: Db,
  draftId: string,
  actorUserId: string | null,
  action: Action,
  prevState: DraftState,
  result: ReduceResult,
): Promise<void> {
  const nextState = result.state;

  const prevLotsById = new Map(prevState.lots.map((l) => [l.id, l]));
  const lots = nextState.lots.filter((l) => prevLotsById.get(l.id) !== l).map((l) => jsonRow(lotToRow(draftId, l)));
  const prevBidsById = new Map(prevState.bids.map((b) => [b.id, b]));
  const bids = nextState.bids.filter((b) => prevBidsById.get(b.id) !== b).map((b) => jsonRow(bidToRow(draftId, b)));
  const nextPickIds = new Set(nextState.picks.map((p) => p.id));
  const removedPickIds = prevState.picks.filter((p) => !nextPickIds.has(p.id)).map((p) => p.id);
  const prevPickIds = new Set(prevState.picks.map((p) => p.id));
  const addedPicks = nextState.picks.filter((p) => !prevPickIds.has(p.id)).map((p) => jsonRow(pickToRow(draftId, p)));

  const payload = {
    draftId,
    actorUserId,
    type: action.type,
    action,
    lots,
    bids,
    removedPickIds,
    addedPicks,
    draft: {
      phase: nextState.phase,
      auction_round: nextState.auctionRound,
      current_lot_id: currentLotId(nextState),
      current_pick_no: nextState.picks.length + 1,
      paused: nextState.paused,
      break_ends_at: nextState.breakEndsAt !== null ? new Date(nextState.breakEndsAt).toISOString() : null,
      version: nextState.version,
      engine_state: extractBookkeeping(nextState),
    },
  };

  await db.execute(sql`
    with p as (select ${JSON.stringify(payload)}::jsonb as j),
    lot_up as (
      insert into lot (id, draft_id, round, order_in_round, player_id, nominated_by_team_id, state, tie_round, ends_at, remaining_ms,
                       winner_team_id, price, eligible_team_ids, tied_team_ids, reveal_top_n)
      select r.id, r.draft_id, r.round, r.order_in_round, r.player_id, r.nominated_by_team_id, r.state::lot_state, r.tie_round, r.ends_at,
             r.remaining_ms, r.winner_team_id, r.price, r.eligible_team_ids, r.tied_team_ids, r.reveal_top_n
      from p, jsonb_to_recordset(p.j->'lots') as r(
        id text, draft_id uuid, round int, order_in_round int, player_id uuid, nominated_by_team_id uuid, state text, tie_round int,
        ends_at timestamptz, remaining_ms int, winner_team_id uuid, price int, eligible_team_ids jsonb, tied_team_ids jsonb, reveal_top_n text)
      on conflict (draft_id, id) do update set
        round = excluded.round, order_in_round = excluded.order_in_round, player_id = excluded.player_id,
        nominated_by_team_id = excluded.nominated_by_team_id, state = excluded.state, tie_round = excluded.tie_round,
        ends_at = excluded.ends_at, remaining_ms = excluded.remaining_ms, winner_team_id = excluded.winner_team_id,
        price = excluded.price, eligible_team_ids = excluded.eligible_team_ids, tied_team_ids = excluded.tied_team_ids,
        reveal_top_n = excluded.reveal_top_n
      returning 1
    ),
    bid_up as (
      insert into bid (id, draft_id, lot_id, team_id, tie_round, amount, received_at, superseded, pass)
      select r.id, r.draft_id, r.lot_id, r.team_id, r.tie_round, r.amount, r.received_at, r.superseded, r.pass
      from p, jsonb_to_recordset(p.j->'bids') as r(
        id text, draft_id uuid, lot_id text, team_id uuid, tie_round int, amount int, received_at timestamptz, superseded boolean, pass boolean)
      on conflict (draft_id, id) do update set
        lot_id = excluded.lot_id, team_id = excluded.team_id, tie_round = excluded.tie_round, amount = excluded.amount,
        received_at = excluded.received_at, superseded = excluded.superseded, pass = excluded.pass
      returning 1
    ),
    pick_del as (
      delete from pick using p
      where pick.draft_id = (p.j->>'draftId')::uuid and pick.id in (select jsonb_array_elements_text(p.j->'removedPickIds'))
      returning 1
    ),
    pick_ins as (
      insert into pick (id, draft_id, pick_no, round, team_id, player_id, source, price, made_at)
      select r.id, r.draft_id, r.pick_no, r.round, r.team_id, r.player_id, r.source::pick_source, r.price, r.made_at
      from p, jsonb_to_recordset(p.j->'addedPicks') as r(
        id text, draft_id uuid, pick_no int, round int, team_id uuid, player_id uuid, source text, price int, made_at timestamptz)
      returning 1
    ),
    draft_up as (
      update draft set
        phase = (p.j->'draft'->>'phase')::draft_phase,
        auction_round = (p.j->'draft'->>'auction_round')::int,
        current_lot_id = p.j->'draft'->>'current_lot_id',
        current_pick_no = (p.j->'draft'->>'current_pick_no')::int,
        paused = (p.j->'draft'->>'paused')::boolean,
        break_ends_at = (p.j->'draft'->>'break_ends_at')::timestamptz,
        version = (p.j->'draft'->>'version')::int,
        engine_state = p.j->'draft'->'engine_state'
      from p
      where draft.id = (p.j->>'draftId')::uuid
      returning 1
    ),
    audit as (
      insert into audit_event (draft_id, seq, actor_user_id, type, payload_json)
      select (p.j->>'draftId')::uuid,
             coalesce((select max(seq) from audit_event where draft_id = (p.j->>'draftId')::uuid), 0) + 1,
             (p.j->>'actorUserId')::uuid, p.j->>'type', p.j->'action'
      from p
      returning 1
    )
    select (select count(*) from draft_up) as drafts_updated
  `);
}
