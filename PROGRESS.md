# Progress notes — read this first when picking the project back up

Last updated 2026-09-26, after the session that built the Commissioner console,
fixed undo to match SPEC, and built Rosters & budgets.
This file is a handoff snapshot, not permanent documentation — SPEC.md and
UI.md are the source of truth for rules/design; this just tracks where we are
and what's next.

## Where things stand, phase by phase

**Phase 1 — Rules engine (`packages/engine`)**: done. Pure `reduce(state, action, ctx)`,
179 tests, full 12-team scripted draft acceptance test. Committed.

**Phase 2 — Server (`apps/server`)**: done. Postgres schema (Drizzle), hybrid
persistence, in-process timer scheduler with downtime recovery, HTTP routes,
Socket.IO wiring, bid secrecy enforced at the snapshot boundary. 18 integration
tests (now 23) including the literal "restart mid-lot loses nothing" acceptance test.
Committed (`5936209`, `31e1216`).

**Phase 3 — UI (`apps/web`)**: in progress. Every draft-day screen is built
and manually verified against a live server; what's missing is the pre-draft
flow (League setup + Lobby). Committed (`597aa7a`, `49b5083`, plus the Rosters
& budgets commit).

## What's actually built and working in apps/web

- **Infra**: Vite + React + Tailwind (tokens from UI.md's table), React Router,
  a `DraftProvider` that holds one authoritative `DraftSnapshot` per draft and
  refreshes it via `resync` on any server event rather than re-deriving state
  transitions client-side (see `apps/web/src/store/DraftProvider.tsx`'s doc
  comment for why). Dev-only login (`/login`) mints a session via the existing
  `/dev/session` route; the big board (`/board/:draftId`) auto-mints a
  throwaway spectator session so it needs no login of its own.
- **Bid** — phone and laptop layouts (`components/bid/`), fully wired: sealed
  bid submit/change, client-side min/budget hints, server error codes as the
  final word, "N of M have bid" strip, laptop's round-lots/roster/all-teams
  panels.
- **Big board** (`components/board/BigBoardScreen.tsx`) — live-lot hero,
  bid-status strip, round-lots grid, teams overview. Also flips to the
  nomination-in-progress, tie-rebid, reveal, and snake-board views as
  appropriate (see below) — reuses the same components the team-facing
  screens use rather than a separate board-specific implementation.
- **Nominate** (`components/nominate/`) — search, position pills, "this round
  so far", correct snake-direction label.
- **Reveal** (`components/reveal/RevealScreen.tsx`) — the one screen that
  isn't snapshot-driven. The engine resolves a lot's
  `open → closed → revealed → awarded` atomically inside one `reduce()` call,
  so revealed bid amounts only ever exist as the `lot:reveal` /
  `lot:tieRebidRevealed` event payloads, never as a resting state.
  `DraftProvider` captures both event types (linking a `tieRebidRevealed` to
  the `lot:awarded` that follows it, for the tie-resolution case) and holds
  them on screen for a fixed ~10s display window before falling back to
  whatever the live snapshot shows next.
- **Tie re-bid** (`components/tie/`) — "You're still tied" banner, "how we got
  here" history with knocked-out teams struck through, −/+ $5 steppers +
  quick-add buttons, "Tie-break in progress" variant for teams not in the tie.
- **Snake pick** (`components/snake/`) — on-the-clock banner with next-3
  preview, "you still need" position chips, Available/Board tabs (Board tab's
  grid, `SnakeBoardGrid.tsx`, is reused by the big board too), position-limit
  greying with the actual reason.

- **Commissioner console** (`components/commish/`, route
  `/draft/:draftId/commish`, linked from the draft header for the
  commissioner only) — status line, Start (stopgap until the Lobby exists),
  Pause/Resume, +15 s, timed breaks, clock-length steppers (5 s steps, clamped
  to SPEC's ranges, debounced into one `admin:setClocks`), Undo naming exactly
  what it undoes with a confirm step, a tie-fallback panel for "commissioner
  decides", and who's connected. Verified in headless Chrome against a live
  server. Pure text helpers are unit-tested (`consoleText.test.ts` — the first
  `apps/web` tests; `pnpm test` now runs them).
- **Rosters & budgets** (`components/rosters/`, route
  `/draft/:draftId/rosters`, "Rosters" link in the draft header for everyone)
  — all-teams table (money left, max bid, auction spots left, roster count;
  "You"/"Broke" on their own line under the name so truncation never leaves
  broke as color-only) plus one team's roster by position group with counts
  vs limits and how each player was acquired. No mockup exists for this
  screen; it follows the existing team panels' style. Data helpers in
  `rosterData.ts` are unit-tested. Verified in headless Chrome at phone and
  laptop widths, including a live update while open.
- `routes/DraftSubpage.tsx` is the shared frame (back link, connection badge,
  paused banner, own socket) for secondary screens — the console and rosters
  both use it.

Every screen reuses `@draft-app/engine`'s own selectors (`remainingBudget`,
`canBidOnPlayer`, `wouldExceedPositionMax`, `positionGroupCount`,
`nominationOrderForRound`, etc. — see `store/selectors.ts`'s `asEngineState`
bridge) rather than reimplementing eligibility/budget/roster logic client-side.

## Small supporting changes made to phase 1/2 code along the way

These weren't scope creep — the UI genuinely couldn't work without them:
- `myTeamId` added to the per-socket `state:snapshot` payload
  (`apps/server/src/ws/registerSocketServer.ts`) — the engine's `Team` type
  deliberately has no `userId`, so the client had no other way to know which
  team is its own.
- `Player.byeWeek` added to the engine type + `playerFromRow` mapper (mirrors
  the existing optional `nflTeam`) — was in the DB but dropped at hydration.
- `packages/engine/src/selectors/order.ts` (snake nomination-order direction)
  added to the engine's public export barrel — needed so the UI can compute
  "nominated 1 → 12" and "who's up next" without reimplementing that logic.

Commissioner-console session:
- **Presence** (`apps/server/src/ws/presence.ts`): in-memory count of joined
  sockets per user per draft; broadcasts `presence:update { connectedTeamIds }`
  on join/leave. Not draft state — never persisted, no version bump, and the
  client applies it directly instead of resyncing.
- Per-socket snapshot now also carries `isCommissioner` and
  `connectedTeamIds` (alongside `myTeamId`).
- `CLOCK_RANGES_SEC` (`packages/engine/src/settings/ranges.ts`) holds SPEC's
  clock ranges; the server's `admin:setClocks` schema rejects anything outside
  them. League creation doesn't validate them yet.
- **Undo now follows SPEC** (it used to reopen the undone lot, which broke the
  DB's one-open-lot rule whenever the next lot was already open — the undo
  failed with a server error). An undone award's lot is now
  `returnedToPool`, the player is back in the pool, the budget/spot come back,
  the draft pauses (freezing whatever clock was live), and the live lot's
  eligibility is refreshed so the ex-winner can bid on it again. The undo-only
  `paused` lot state is no longer produced (still in the type/DB enum).
- `restart-recovery.test.ts` now only checks its own draft's recovery — it
  was failing because leftover dev-DB drafts also got "recovered".

## Known, intentional gaps (not bugs — flagged as they came up)

- **No pre-draft UI at all.** Every league/team/player/draft used in this
  session's manual testing was created via throwaway scripts talking directly
  to the phase-2 HTTP/WS API (see conversation history — scripts were deleted
  after each use, nothing checked in). There is currently no League setup
  screen, no Lobby (team join/claim, draft order, start button), and no real
  invite/claim-team flow. This is the biggest remaining hole before someone
  could run a real draft end-to-end without me hand-driving the API.
- **Real auth is still phase-4.** Login is the dev-only `/dev/session` shim;
  real magic-link auth was explicitly deferred back in phase 2 planning.
- **Watchlist/queue isn't built.** Snake pick's "My queue" tab shows an
  explicit "isn't built yet" placeholder rather than faking it — this needs
  its own server-side storage (nothing exists for it in phase 2 either).
- **Big board has no league name** — no endpoint currently exposes it to an
  unauthenticated board view, so the header just says "Draft Day".
- **Big board's "skipped nomination" note is omitted** (e.g. "Team 11 is
  broke, so it skipped nominating") — the engine doesn't expose which team's
  turn was skipped in a queryable way, so this wasn't guessed at.
- **Snake's "next 3 teams" preview ignores deferred pick-clock-expiry
  catch-up insertions** (the `pickExpiryAction: "skip"` edge case) — it's a
  preview hint, not something a decision depends on, and correctly replicating
  the engine's insertion-order logic client-side risked duplicating business
  rules for little benefit.
- **A reconnect mid-bid can't show your own bid amount** — the server never
  reveals bid amounts back to anyone before a lot resolves, not even the
  bidder, so "Your bid is in" shows `•••` instead of a remembered number after
  a refresh. This is real phase-2 secrecy behavior, not a UI bug.
- **Few automated frontend tests.** Only pure helpers (console text, roster
  data) are unit-tested; screens are verified by hand. No Playwright suite yet.
- **The big board has no Rosters view** — it's a separate spectator route and
  only shows the teams overview column. Rosters & budgets needs a login.
- **A browser console 404 on every page load** during headless checks; its
  source wasn't tracked down (likely a missing favicon — unverified).
- **Undo doesn't roll back a phase change.** Undoing the award that ended the
  auction leaves the draft in the snake. SPEC is silent; not handled.
- **Undoing a snake pick doesn't pause** and doesn't give the team its turn
  back — unchanged from phase 1; SPEC only spells out the award case.
- **Console gaps vs SPEC:** no edit budget/roster (no server intent, and how
  an edit is recorded is a rules decision to ask about), no void lot / mark
  player unavailable buttons (server intents exist), no 10-second "back in"
  countdown after a break (engine doesn't do it).

## What's left

In rough priority order:
1. **League setup + Lobby** — next up — the pre-draft flow. Bigger than the rest
   combined: settings form, invite link, team join/claim, draft order
   assignment, start button. Needed before this app is usable without me
   scripting the setup by hand.
2. The console gaps listed above.
3. Real auth, watchlist/queue, CSV export, settings-editing after creation —
   all previously deferred to phase 3/4, still deferred.

## How to pick this back up tomorrow

- `apps/server`: `pnpm --filter @draft-app/server dev` (or
  `node --env-file=.env node_modules/tsx/dist/cli.mjs src/index.ts` from
  inside `apps/server` — the plain `dev` script needs Bash's `node
  --env-file`, not PowerShell's).
- `apps/web`: `pnpm --filter @draft-app/web dev`, then http://localhost:5173.
- Both `pnpm run typecheck` and `pnpm run build` are clean across all three
  packages as of the Rosters & budgets commit.
- Headless browser checks: Chrome is installed; `playwright-core` with
  `channel: "chrome"` works (install it in a scratch dir, not the repo).
- There's still no claim-team route, so demo drafts need a direct
  `update team set user_id = ...` after `POST /leagues`.
- The Supabase dev DB from this session still has several leftover test
  leagues/drafts in it (named things like "Snake Demo League", "Nominate Demo
  League") — harmless, but worth a scoped cleanup pass (by league name, never
  an unscoped `DELETE`) before or during the Commissioner console work if it
  gets noisy.
