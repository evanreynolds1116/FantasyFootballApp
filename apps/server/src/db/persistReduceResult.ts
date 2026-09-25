import type { Action, DraftState, ReduceResult } from "@draft-app/engine";
import { count, eq, inArray } from "drizzle-orm";
import type { Db } from "./client.js";
import { extractBookkeeping } from "./engineState.js";
import { bidToRow, lotToRow, pickToRow } from "./mappers.js";
import { auditEvent, bid, draft, lot, pick } from "./schema.js";

/** A reduce() call that only produced a draft:rejected event never changed state — nothing to persist. */
export function wasRejected(result: ReduceResult): boolean {
  return result.events.length === 1 && result.events[0]?.type === "draft:rejected";
}

function currentLotId(state: DraftState): string | null {
  const terminal = new Set(["awarded", "returnedToPool", "cancelled"]);
  return state.lots.find((l) => !terminal.has(l.state))?.id ?? null;
}

/**
 * Diffs prevState vs result.state and writes the change in one transaction:
 * lots/bids upserted by id, picks inserted/deleted, draft row's scalar
 * columns + engine_state + version rewritten, one audit_event appended.
 * Diffing uses reference (in)equality — the engine's immutable-update style
 * means an untouched array element keeps the exact same object reference.
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

  await db.transaction(async (tx) => {
    const prevLotsById = new Map(prevState.lots.map((l) => [l.id, l]));
    for (const l of nextState.lots) {
      if (prevLotsById.get(l.id) === l) continue;
      const row = lotToRow(draftId, l);
      await tx
        .insert(lot)
        .values(row)
        .onConflictDoUpdate({ target: lot.id, set: row });
    }

    const prevBidsById = new Map(prevState.bids.map((b) => [b.id, b]));
    for (const b of nextState.bids) {
      if (prevBidsById.get(b.id) === b) continue;
      const row = bidToRow(b);
      await tx
        .insert(bid)
        .values(row)
        .onConflictDoUpdate({ target: bid.id, set: row });
    }

    const nextPickIds = new Set(nextState.picks.map((p) => p.id));
    const removedPickIds = prevState.picks.filter((p) => !nextPickIds.has(p.id)).map((p) => p.id);
    if (removedPickIds.length > 0) {
      await tx.delete(pick).where(inArray(pick.id, removedPickIds));
    }
    const prevPickIds = new Set(prevState.picks.map((p) => p.id));
    for (const p of nextState.picks) {
      if (prevPickIds.has(p.id)) continue;
      await tx.insert(pick).values(pickToRow(draftId, p));
    }

    await tx
      .update(draft)
      .set({
        phase: nextState.phase,
        auctionRound: nextState.auctionRound,
        currentLotId: currentLotId(nextState),
        currentPickNo: nextState.picks.length + 1,
        paused: nextState.paused,
        breakEndsAt: nextState.breakEndsAt !== null ? new Date(nextState.breakEndsAt) : null,
        version: nextState.version,
        engineState: extractBookkeeping(nextState),
      })
      .where(eq(draft.id, draftId));

    const [countRow] = await tx
      .select({ value: count() })
      .from(auditEvent)
      .where(eq(auditEvent.draftId, draftId));
    await tx.insert(auditEvent).values({
      draftId,
      seq: (countRow?.value ?? 0) + 1,
      actorUserId,
      type: action.type,
      payloadJson: action,
    });
  });
}
