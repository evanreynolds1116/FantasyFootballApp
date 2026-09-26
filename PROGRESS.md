# Progress notes — read this first when picking the project back up

Last updated 2026-09-26, after the session that built the Commissioner console,
Rosters & budgets, League setup and the Lobby, then ran full-length scripted
mock drafts and fixed what they found (make-up screen, results screen, bid
secrecy, make-up turn order, a server crash, persistence latency).
This file is a handoff snapshot, not permanent documentation — SPEC.md and
UI.md are the source of truth for rules/design; this just tracks where we are
and what's next.

## Where things stand, phase by phase

**Phase 1 — Rules engine (`packages/engine`)**: done. Pure `reduce(state, action, ctx)`,
198 tests, full 12-team scripted draft acceptance test. Committed.

**Phase 2 — Server (`apps/server`)**: done. Postgres schema (Drizzle), hybrid
persistence, in-process timer scheduler with downtime recovery, HTTP routes,
Socket.IO wiring, bid secrecy enforced at the snapshot boundary. 18 integration
tests (now 32) including the literal "restart mid-lot loses nothing" acceptance test.
Committed (`5936209`, `31e1216`).

**Phase 3 — UI (`apps/web`)**: every screen in SPEC's table is built and
verified in headless Chrome against a live server, including the pre-draft flow
(League setup, Lobby, invite/claim). A full setup → join → start → draft run
works through the UI alone, and two full-length 12-team scripted mock drafts
(see "Mock draft runs" below) have finished clean. SPEC's phase-3 "done when" —
friends complete a mock draft on phones — hasn't happened yet. Committed
(`597aa7a`, `49b5083`, `dcc84c4`, `b09770d`, plus the mock-draft fixes commit).

## What's actually built and working in apps/web

- **Pre-draft flow** (no mockups exist for these; they follow the draft
  screens' style):
  - Home `/` — your leagues with status, create a league, join by code.
  - League setup `/league/new` (and `/league/:id/settings` to edit before the
    start) — every SPEC setting with defaults filled in, a plain-English
    "rules at a glance" summary (`setup/ruleSummary.ts`), and live errors from
    the engine's own `validateSettings`.
  - Join `/join/:code` — log in if needed, pick an open team, name it.
  - Lobby `/league/:id` — polls GET /leagues/:id every 3 s (no draft room
    exists before Start). Teams in draft order with rename, move up/down,
    server-side shuffle and "remove manager"; the invite link (copy/replace);
    the player pool (CSV upload with preview via `lib/playerCsv.ts`, one-off
    add, browse/remove); rules summary; Start with a warning for unclaimed
    teams that spells out what their clocks will do. Start is held while a
    reorder is in flight. Everyone watching is moved into the draft when it
    starts.
  - Page paths avoid the API prefixes Vite proxies (`/league/…` pages vs
    `/leagues` API, `/draft/…` vs `/drafts`) — see `vite.config.ts`.
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
- **Make-up rounds** reuse the snake pick screen (`SnakePickScreen` handles
  phase "makeup"): the broke team gets "Your make-up pick" and an
  explanation; everyone else sees "Your roster is full". The board grid
  (phone Board tab and big board) adds M1, M2… rows. Turn order comes from
  the engine's `makeupOrderForRound`.
- **Results** (`components/results/`, SPEC Flow 4) — shown on the draft
  screen and the big board once the phase is "complete": rosters & spend
  (reusing the Rosters pieces), the full draft log with only the runner-up
  bids that were revealed, and a client-side CSV download (FR-18). The big
  board link needs no login, so it doubles as the shareable results page.
  There's no server `/drafts/:id/export.csv` route yet.
- A draft link with a bad/unknown id shows "Draft not found" instead of
  loading forever (`primitives/DraftNotFound.tsx`).
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

League setup + Lobby session:
- **Settings validation** (`packages/engine/src/settings/validate.ts`):
  SPEC's ranges plus "position minimums must fit the roster". POST and PATCH
  /leagues reject anything else. Reveal top-N is allowed up to 20 regardless
  of team count (top 3 in a 2-team league just shows every bid).
- **New routes**: GET /leagues, GET/PATCH /leagues/:id (team-count changes
  add/remove unclaimed slots, never evict a manager), POST
  /leagues/:id/invites, GET /invites/:code, POST /invites/:code/claim, PATCH
  /leagues/:id/teams/:teamId, DELETE /leagues/:id/teams/:teamId/manager,
  POST /leagues/:id/draft-order/shuffle, GET/POST/DELETE
  /leagues/:id/players (POST takes `replace`), POST /leagues/:id/start.
  POST /leagues makes placeholder slots "Team 1..N" when no team names are
  given. Every setup edit returns 409 LOCKED once the league has a draft.
- **The draft row is now created at Start** (POST /leagues/:id/start creates
  it and applies admin:start), so lobby edits never go stale in the runtime's
  in-memory state. Start requires a pool of at least teams × roster size.
- **Migrations**: `0003_league_invites` (league.invite_code, plus a unique
  (league_id, user_id) index so one person can't hold two teams in a league)
  and `0004_drop_nominator_must_bid`. Both applied to the Supabase dev DB.
- **"Nominator must bid on own nominee" was dropped** (user's call,
  2026-09-26): the engine never enforced it, so it's gone from the settings
  type, defaults, validator, DB and mappers. SPEC.md still lists it in the
  settings table — it's deferred, not rejected; re-adding it means engine
  enforcement + tests + a migration.
- Tests that need out-of-range leagues (1 team, 2 s clocks) use the test-only
  `createLeagueUnchecked` helper in `apps/server/test/helpers.ts`.
- Inline favicon in `apps/web/index.html` — this was the mystery browser 404.

Mock-draft session (fixes found by full-length scripted runs):
- **Bid secrecy after reveal — fixed.** The snapshot used to include every
  bid amount on an awarded lot, so losing bids the reveal hid ("N other bids
  stay hidden") went to every client, and a lot voided mid-bidding exposed
  its sealed bids. An earlier session had allowed post-award amounts on
  purpose; SPEC says hidden losing bids never leave the server, so SPEC won.
  Now the engine's `revealedBidIds` (`selectors/secrecy.ts`) decides: opening
  round = top N by the setting recorded on the lot at reveal
  (`Lot.revealTopN`, column `lot.reveal_top_n`, migration `0005`), tie
  re-bids in full once their round closes, superseded/voided never.
  `toPublicSnapshot` uses it; network test in `bid-secrecy.test.ts`.
- **Make-up turn order — fixed.** A team filling its last make-up spot
  mid-round made the next team lose its turn (the order shrank under the
  turn counter). `makeupOrderForRound` fixes each round's order at round
  start; engine tests cover it.
- **Server crash on a malformed draft id — fixed.** A socket `join` with a
  non-UUID id threw an unhandled rejection and killed the process (found
  when a board link with a placeholder id was opened mid-run). join/resync
  now validate and catch; regression test in `reconnect.test.ts`.
- **Persistence is one SQL statement per action.** postgres.js needs two
  round trips per parameterised statement and can't pipeline them, so the
  old 5–8-statement transaction cost 8+ round trips (~26 ms each to the
  Supabase dev DB). `persistReduceResult` now sends the whole diff as one
  jsonb parameter applied by data-modifying CTEs (atomic without
  BEGIN/COMMIT). Sockets also cache their team id and commissioner flag at
  join/resync instead of querying per intent. Ack latency: single action
  ~320 ms → ~58 ms; 12 simultaneous bids, slowest ack 3.4 s → 0.7 s.

## Known, intentional gaps (not bugs — flagged as they came up)

- **Pre-draft gaps:** no team avatars (optional in FR-02), no "mock round"
  (SPEC Flow 1 step 5), players can be added/removed but not edited, and the
  live MFL player import is still phase 4 (CSV of an MFL export works).
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
  data, CSV parsing, rules summary, start checks, results log/CSV) are
  unit-tested; screens are verified by hand. No Playwright suite yet.
- **Bid acks under a rush still exceed SPEC's 300 ms** for the last of 12
  simultaneous bidders (~0.7 s) because actions are persisted one at a time
  per draft and each save is ~2 round trips to the remote dev DB. A database
  co-located with the server should fix it; if not, the next step would be
  batching queued actions into one save ("group commit").
- **During a tie, the reveal's "Up next" card names the tied lot itself**
  (it's still the current lot). Minor, not fixed.
- **The big board has no Rosters view** — it's a separate spectator route and
  only shows the teams overview column. Rosters & budgets needs a login.
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
1. **A real mock draft with friends on phones** — SPEC's phase-3 "done when".
   The scripted runs are clean; this needs the app reachable from phones
   (hosting, or the dev server on the LAN).
2. The console gaps listed above.
3. Real auth, watchlist/queue, a server CSV export route, settings-editing
   after creation — all previously deferred to phase 3/4, still deferred.

## Mock draft runs

A scripted full-length run drives the live server over HTTP + Socket.IO with
12 bot managers (default league settings, 10 s clocks): $25-step bids so ties
are common, one or two teams that go broke on purpose, passes, pause/resume,
+15 s, undo, and nomination/pick clock expiries. A spectator socket checks
every broadcast and periodic snapshots against exactly what each reveal
showed; headless Chrome watches the big board and a broke team's screen. At
the end it checks every roster (17 players, position limits, auction +
make-up = 8, no overspend, no player twice), DB vs state, and audit seq.
Latest run: 17.6 min, 94 lots (67 ties), no findings. The script lives in the
session scratchpad, not the repo — worth checking in (e.g. as
`apps/server/scripts/mock-draft.mjs`) before the next big change.

## How to pick this back up tomorrow

- `apps/server`: `pnpm --filter @draft-app/server dev` (or
  `node --env-file=.env node_modules/tsx/dist/cli.mjs src/index.ts` from
  inside `apps/server` — the plain `dev` script needs Bash's `node
  --env-file`, not PowerShell's).
- `apps/web`: `pnpm --filter @draft-app/web dev`, then http://localhost:5173.
- Both `pnpm run typecheck` and `pnpm run build` are clean across all three
  packages as of the mock-draft fixes commit. Note `pnpm run typecheck`
  checks the server against the engine's built `dist`, so run `pnpm run build`
  (or build the engine) first after changing engine types.
- Headless browser checks: Chrome is installed; `playwright-core` with
  `channel: "chrome"` works (install it in a scratch dir, not the repo).
- Demo drafts can now be set up through the UI (or POST /leagues + POST
  /invites/:code/claim) — no more direct `update team set user_id` needed.
- The Supabase dev DB from this session still has several leftover test
  leagues/drafts in it (named things like "Snake Demo League", "Nominate Demo
  League") — harmless, but worth a scoped cleanup pass (by league name, never
  an unscoped `DELETE`) before or during the Commissioner console work if it
  gets noisy.
