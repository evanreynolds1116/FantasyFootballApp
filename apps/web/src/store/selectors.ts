import type { DraftState } from "@draft-app/engine";
import type { DraftSnapshot } from "../lib/contracts";

/**
 * @draft-app/engine's selectors take a `DraftState`, which is identical to
 * `DraftSnapshot` except for `bids` (secrecy-scrubbed on the wire). None of
 * the budget/roster/eligibility/lots selectors read `state.bids` — only its
 * *type* differs — so reusing them against a snapshot is safe. See
 * apps/server/src/shared/publicSnapshot.ts for the scrubbing itself.
 */
export function asEngineState(snapshot: DraftSnapshot): DraftState {
  return snapshot as unknown as DraftState;
}
