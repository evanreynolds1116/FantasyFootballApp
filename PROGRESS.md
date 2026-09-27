# Progress notes — read this first when picking the project back up

Last updated 2026-09-26, after the session that built the Commissioner console,
Rosters & budgets, League setup and the Lobby, then ran full-length scripted
mock drafts and fixed what they found (make-up screen, results screen, bid
secrecy, make-up turn order, a server crash, persistence latency), added a
Pass option to auction bidding, wrote the README, made a screenshot walkthrough
for the league, ran a manual test (user as commissioner + 11 bots), and added a
live "nominated this round" list to the nominate screen and big board.
Then (same day) built the watchlist/queue (FR-19), sounds and vibration
(FR-20), and closed the commissioner console gaps (edit budget/roster, void
lot, injuries, 10-second "back in" countdown), then real sign-in (email code
+ magic link), then turned the reveal into a build-up show with the next
clock held until it's over, refreshed the README and all its screenshots,
gave the big board a TV-sized reveal, and added the server CSV export and
mid-draft settings (reveal setting, league rename).
This file is a handoff snapshot, not permanent documentation — SPEC.md and
UI.md are the source of truth for rules/design; this just tracks where we are
and what's next.

## Where things stand, phase by phase

**Phase 1 — Rules engine (`packages/engine`)**: done. Pure `reduce(state, action, ctx)`,
246 tests, full 12-team scripted draft acceptance test. Committed.

**Phase 2 — Server (`apps/server`)**: done. Postgres schema (Drizzle), hybrid
persistence, in-process timer scheduler with downtime recovery, HTTP routes,
Socket.IO wiring, bid secrecy enforced at the snapshot boundary. 18 integration
tests (now 51) including the literal "restart mid-lot loses nothing" acceptance test.
Committed (`5936209`, `31e1216`).

**Phase 3 — UI (`apps/web`)**: every screen in SPEC's table is built and
verified in headless Chrome against a live server, including the pre-draft flow
(League setup, Lobby, invite/claim). A full setup → join → start → draft run
works through the UI alone, and two full-length 12-team scripted mock drafts
(see "Mock draft runs" below) have finished clean. SPEC's phase-3 "done when" —
friends complete a mock draft on phones — hasn't happened yet. Committed
through `468cf86` (nominations list), then README screenshots and the
watchlist/queue and sounds/vibration (see below). [README.md](README.md) walks through every screen, the rules, the
architecture, the stack, setup and the API.

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
  bid submit/change and Pass, client-side min/budget hints, server error
  codes as the final word, "N of M are in" strip, laptop's
  round-lots/roster/all-teams panels. On laptops the Lock in bid / Pass
  buttons sit on their own row under the amount field (the middle column is
  only ~400px wide at 1280px).
- **Big board** (`components/board/BigBoardScreen.tsx`) — live-lot hero,
  bid-status strip, round-lots grid, teams overview. During nominations it
  shows `NominationsGrid` (a tile per team in nomination order: the player
  each put up, the team on the clock with its countdown, teams still to
  come). Also flips to the tie-rebid, reveal, and snake-board views as
  appropriate (see below) — reuses the same components the team-facing
  screens use rather than a separate board-specific implementation.
- **Nominate** (`components/nominate/`) — a live "Nominated this round" list
  right under the banner (player, position, nominating team, who's
  nominating now, who's next; `nominationData.ts`), search, position pills,
  snake-direction label. Searching for a player who can't be nominated shows
  him greyed with the reason (already nominated this round, already drafted,
  marked unavailable) instead of "no players match".
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
- **Watchlist/queue** (FR-19, `components/queue/`, `lobby/MyQueuePanel.tsx`) —
  one ranked, private queue per manager. Built in the lobby ("My queue" panel:
  search, star, ↑ ↓ ✕) or during the draft (☆/★ on every nominate and snake
  row, a "★ My queue (n)" filter on the nominate screen, a ranked "My queue"
  tab on snake pick with a Draft button). Taken players drop off. When a
  clock runs out, auto-nominate takes the top available queued player and
  auto-pick the first queued player who fits the roster, each falling back
  to the old best-available rule. Verified live in headless Chrome
  (lobby queue → auto-nominate → snake auto-pick), no page errors.
- **Reveal show** (`components/reveal/RevealScreen.tsx`, `revealTimeline.ts`).
  The user found the reveal anticlimactic; decisions: the full ~8 s show,
  hold the next lot until the reveal ends, a "You won!" moment and a
  drumroll (not chosen: record badges, tap to skip).
  - Show, timed from the `lot:reveal` message so every screen is in step:
    face-down card per locked-in entry shaking to a speeding-up drumroll
    (2.4 s) → runner-ups the reveal setting allows flip lowest first, a thud
    each (gaps shrink so even "all bids" fits) → "And the winner is…" (1 s) →
    winner card slams, price counts up from the best runner-up, "won by $N",
    confetti → hidden bids/passes become padlocks, budget/spots tiles and
    "Up next · clock starts in". Winner's own phone: full-screen "You won!"
    + long buzz. Ties slam "It's a tie!". A tie's final result gets the same
    show (`afterTie`). Reduced motion keeps the stages without the motion.
    Sounds only on the draft screen (the big board is silent); reveal cues
    moved out of DraftAlerts into the show.
  - Engine: `REVEAL_HOLD_MS` (10 s) and `afterReveal(ctx)` in `clock.ts`.
    Whatever follows a reveal — next lot, next nomination round, tie re-bid,
    snake — starts its clock from now + 10 s; awards keep the real time.
    `revealHoldUntil` in state (persisted in the bookkeeping jsonb) lets
    clients hold clock readouts (`useClockHold`), like the back-in hold;
    pausing during a reveal banks the whole next clock. This was a real bug
    before: the next lot's bid clock ran during the reveal. Adds ~10 s per
    lot, which SPEC's "60 s bid + 10 s reveal" already assumed.
  - `tests/rules/revealHold.test.ts` (4) and `revealTimeline.test.ts` (7);
    one tie/pause test moved past the reveal. Verified live on a phone:
    stage screenshots, vibration order, next clock at a full 60 s.
- **Second manual mock draft (user as commissioner + 11 bots, "Test 2")**,
  with a real 2026 NFL pool: `nfl-players-2026.csv` (in the user's
  Downloads, not the repo) — 306 players built from MFL's public 2026 data
  (players, ADP over all 6,729 MFL drafts, bye weeks), MFL ids kept, QB 36 /
  RB 80 / WR 90 / TE 36 / K 32 / DEF 32, plus a Photo column (Sleeper
  headshots, team logos for defenses; 305 of 306). Changes from the user's
  feedback during it:
  - Reveal pacing: runner-up flips 1.5 s apart (was 0.8 s); the show's
    timeline moved into the engine (`src/revealShow.ts`) and now always
    ends with a 10-second "Up next" countdown, so the reveal's length
    depends on how many bids are shown (top 3: 17.8 s, winner up 11.4 s;
    winner only 14.8 s; all bids 19.8 s). The server holds the next clock
    for exactly that (`afterReveal(ctx, durationMs)`), and screens use the
    same plan. SPEC's time estimate updated (~2 h 5 min for bidding).
  - Player photos: `player.photo_url` (migration 0009), `photoUrl` on the
    engine's Player, a Photo/Headshot/Image CSV column (https only, checked
    by the parser and the server), `PlayerPhoto` with an initials fallback,
    on the bid card, the reveal (phone + TV) and the big board's live lot.
  - Bye weeks on the big board's live lot and in rosters/results; the bid
    card now puts position · team · bye in the chip above the name, like
    the board.
  - Reveals cut short once only bots were bidding (the user went broke):
    bots bid on the next lot mid-reveal and early close fired. Now the
    engine refuses team moves (nominate, bid, pass, tie re-bid, pick) while
    `revealHoldUntil` is in the future (REVEAL_IN_PROGRESS); commissioner
    controls and queue edits still work. Verified on the live draft: each
    reveal played its full length. The scratchpad `bots.mjs` waits out reveals.
  - The draft finished cleanly (auction → snake → make-up → complete, 204 picks).
  - Fixes: paused clocks showed "--:--" (now the frozen time left, via
    `useCountdown`'s `remainingMs`); the big board's team list cut off
    team 12 on 900-px-tall screens (names now one line); the draft screen's
    "Draft paused" banner had no side margins on phones.
- **Server CSV export + settings after the start**:
  - `GET /drafts/:id/export.csv` (league members; 404 bad/unknown id) —
    built by the engine's new `selectors/results.ts` (`draftLog`,
    `buildResultsCsv`, moved from the web app) from `toPublicSnapshot`, so a
    hidden bid can't appear. New column `revealed_runner_up_bids`;
    commissioner-added players show as "Commissioner"; fields starting with
    = + - @ are neutralized for spreadsheets. File named after the league
    ("…-results-so-far.csv" mid-draft). The results screen's Download CSV
    now fetches it.
  - **Bug fixed:** mid-draft `admin:setClocks` / `admin:setRevealTopN` only
    changed memory — `draft_settings` was never written, so a restart
    lost them. `persistReduceResult` now updates the clock and reveal
    columns in the same single statement when settings change.
  - Console: "Bids shown at reveal" (winner only / top 2–5 / all), from the
    next reveal. Settings page after the start: explains what's locked,
    links to the console, and renames the league (PATCH with only a name is
    allowed after the start; anything else still 409 LOCKED). Lobby link
    reads "Rename league" once locked.
  - `test/settings-and-export.test.ts` (3, incl. a secrecy check with
    "winner only") and `tests/selectors/results.test.ts` (5). Verified live:
    console, rename, and a real Download CSV of a finished draft.
- **TV-sized reveal**: `RevealScreen` now has a shared `useRevealView` model
  (timeline, flipped bids, count-up, details, sounds) with a phone layout and
  a `size="board"` TV layout at the big board's scale (96px player, 168px
  price, flipped bids and next-up in a right column, bigger confetti, plus
  the pause banner and commissioner notices). Checked live at 1600×900.
- **README refresh**: text brought up to date (queue, alerts, reveal show,
  console edits, sign-in, API/data model) and every screenshot re-shot from
  a new demo draft (`walkthrough2.mjs` in the scratchpad: signs in with real
  email codes read from the server log), plus new ones for the sign-in code,
  reveal stages, tie slam, snake queue, alerts menu, commissioner notice and
  the big board's reveal.
- **Email sign-in** (FR-02, `routes/LoginRoute.tsx`, `VerifyLinkRoute.tsx`,
  `components/login/`; server `http/routes/auth.ts`, `mail/mailer.ts`).
  Decisions from the user: pluggable mailer (pick the provider later), link
  + 6-digit code, dev login kept for development only, 90-day sessions.
  - Flow: email → code (or the link, `/login/verify?t=…`) → first time only,
    pick a display name (`PATCH /me`) → back to `next`. The email is the
    account; a dev-login account with the same email is taken over, so test
    teams carry over.
  - `login_code` table (migration `0008`, applied to the dev DB): hashed
    code + link, 15 min, single use (using one retires every outstanding
    code for the address), 5 wrong tries, 5 emails per address per 15 min.
    Sessions now expire after 90 days; `POST /auth/logout` ends one.
  - Mail: `RESEND_API_KEY` + `MAIL_FROM` send through Resend's HTTP API;
    otherwise the email is printed to the server console. `APP_URL` is the
    link's base.
  - Dev login: `/dev/session` exists only with `DEV_LOGIN=true` (added to
    the local, git-ignored `apps/server/.env`; `.env.example` documents
    it). `GET /auth/config` tells the login page whether to offer it. Test
    servers turn it on and capture sent mail.
  - Big board: no longer uses the dev login — `POST /drafts/:id/spectate`
    gives a watch-only `spec_…` token (one spectator user per draft, 2-day
    sessions) that every HTTP route refuses.
  - Web: any 401, or a socket refused as UNAUTHENTICATED, signs out and
    sends the page to /login. "Switch user" is now "Sign out".
  - `test/auth.test.ts` (11 tests). Verified live with DEV_LOGIN off in
    headless Chrome (code on a phone, link on a laptop, big board with no
    login, sign-out, expired session), no page errors.
- **Commissioner edits** (FR-14 + SPEC's late-injury edge case,
  `components/commish/LotAndPlayersPanel.tsx`, `RosterEditPanel.tsx`,
  `CommishLogPanel.tsx`). Decisions from the user: budget *and* roster edits,
  back-in countdown on *every* resume, void during ties too, mark available
  again, and tell the league.
  - Engine: `commishLog` in DraftState (budget/remove/assign/void/
    unavailable/available) — budget entries count in `remainingBudget`.
    New actions `admin:adjustBudget` (± with reason, never below $0, no
    taking money while that team has a bid/pass in on the current lot),
    `admin:removePick` (back to pool, auction price refunded, its lot marked
    returnedToPool), `admin:assignPlayer` (only into an open spot from
    `openRosterSlots`: auction spot at a price, or a snake spot no remaining
    turn will fill), `admin:markPlayerAvailable`; `admin:voidLot` now also
    works in a tie re-bid. Roster edits are refused during make-up (turn
    order there depends on who still owes a pick). Undo skips
    commissioner-added picks. Pick numbers are max + 1 (`nextPickNo`) so a
    removal can't cause a duplicate. Every edit emits `commish:edit`.
  - Back-in: Resume sets `resumeHoldUntil` = now + 10 s and pushes every
    clock back by it; pausing again banks only real clock time. Clients hold
    the clock readout (`useCountdown` reads the hold) and show an amber
    "Back in… N" banner.
  - Server: `commishLog`/`resumeHoldUntil` in the engine bookkeeping jsonb
    (older drafts default to empty), new intent schemas (commissioner only).
    `test/commish-edits.test.ts`.
  - Web: an 8 s "Commissioner" notice on every screen and the big board;
    the console's new panels; "Your changes" log; results log tab lists
    "Commissioner changes"; "spent at auction" now sums prices (adjustments
    aren't spending). Verified live through the UI in headless Chrome, no
    page errors.
- **Sounds and vibration** (FR-20, `components/alerts/`) — a bell in the
  draft header opens Sounds / Vibration switches (localStorage, per device;
  vibration hidden where unsupported, e.g. iPhone) and a Test button. Cues,
  synthesized with Web Audio (no sound files): chime + buzz when it becomes
  your nomination, tie re-bid or pick turn; ticks at 10 s left if you still
  haven't acted (bids included, once per turn); a bell on each reveal, an
  arpeggio if you won. `myTurn(snapshot)` is the pure, unit-tested helper
  that decides whose turn it is. Sound needs one tap on the page first
  (browser rule). The big board is silent. On narrow phones the header's
  "Connected" shrinks to its dot so the bell fits. Verified live: the cue
  sequence turn → warning → bid warning → won → reveal → snake turn came
  out exactly, no page errors.
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

Pass session (user's feature request, 2026-09-26):
- **Pass in the opening sealed round.** A team can lock in "no bid"
  (`bid:pass` intent, engine `applyBidPass`) so the lot can close early; it
  can switch pass ↔ bid until the clock ends. Stored as a bid row with
  `pass: true`, amount 0 (column `bid.pass`, migration `0006`); the engine's
  `effectiveBidAmount` treats it as no bid, so it never competes.
- User's decisions: a pass looks exactly like a bid before the reveal (same
  `lot:bidStatus`, no `pass` field ever sent to clients); if everyone passes
  the normal no-bid rule applies (nominator included); opening round only —
  refused in tie re-bid rounds; the reveal shows a pass *count* only
  (`lot:reveal.passes`), never who.
- UI: Pass button beside Lock in (phone and laptop), "You passed on this
  player" / "Change bid / pass", "N teams passed" on the reveal. The status
  strip now says "N of M are in" instead of "have bid" (passes count as in);
  SPEC.md and UI.md updated to match.
- The results log's "no bids, nominator" note now keys off "no revealed
  opening amounts" (a winning bid is always revealed), since pass rows look
  like hidden bids in the snapshot.
- After a refresh mid-lot your own screen can't tell whether you bid or
  passed (the server tells no one), so it shows "You're locked in and
  hidden" — same reason your own amount wasn't recoverable before.
- The mock-draft bots still "pass" by not bidding; switch them to `bid:pass`
  next time the script is run, to see the early-close speed-up.

Walkthrough, manual test and nominations session (2026-09-26):
- **League walkthrough doc** for the user to share with the league: every
  step of a demo draft with 25 screenshots and nine questions for feedback
  (clocks, reveal count, pass, ties, no-bid rule, snake expiry, devices,
  confusing screens, practice date):
  https://claude.ai/code/artifact/8b1c6860-0b43-4111-996e-b2f45b50a172
  The league's comments there should feed the next settings/rules decisions.
- **Fixes the screenshots turned up** (`72b84e9`): the laptop bid field pushed
  Lock in bid / Pass out of view at 1280px; the tie banner used a spacing
  class Tailwind doesn't have (`px-4.5`) and had no padding.
- **Manual test:** the user ran the app as commissioner (own team) with 11
  bot managers. The bot script (`bots.mjs`, session scratchpad, not in the
  repo) waits for a new league, claims every open slot except one for the
  commissioner, then plays every bot team (1–5 s delays, passes, tie
  re-bids, snake + make-up picks). `LEAGUE_ID=<id>` reattaches it to an
  existing league. First run had a bug (it forgot its teams right after
  claiming them); fixed and reattached mid-draft. The user stopped partway;
  their **TEST LEAGUE** (draft `68427fef-502d-4719-9108-a698e03b2441`) is
  kept in the dev DB on purpose — don't delete it without asking.
- **Nominations list** (`468cf86`, user's feature request): the nominate
  screen and big board changes above. Display only, no rule change; UI.md
  updated.
- **Queue storage and privacy:** engine gained `queues` in DraftState, a
  `queue:update` action (allowed while paused, max 200 players, deduped) and
  a private `queue:updated` event; `firstQueued` / `availableQueue`
  selectors feed auto-nominate and auto-pick. Server: new `team_queue` table
  (migration `0007`, applied to the dev DB), saved in the same single-statement
  persist; snapshots strip `queues` and add `myQueue` only for the viewer;
  `queue:updated` goes out as `you:private` to that manager's own sockets
  only; `GET/PUT /leagues/:id/queue` for the lobby (PUT goes through the
  engine once a draft exists). `test/queue.test.ts` checks nobody else ever
  receives a queue. SPEC (FR-19, data model, events, edge cases) and UI.md
  updated.
- `bid-secrecy.test.ts`'s pass test now scopes its bid lookup to its own
  draft — lot ids ("lot_N") repeat across drafts, so it had started counting
  TEST LEAGUE's passes.

## Known, intentional gaps (not bugs — flagged as they came up)

- **Pre-draft gaps:** no team avatars (optional in FR-02), no "mock round"
  (SPEC Flow 1 step 5), players can be added/removed but not edited, and the
  live MFL player import is still phase 4 (CSV of an MFL export works).
- **Sign-in emails aren't really sent yet** — they're printed to the server
  console until `RESEND_API_KEY`/`MAIL_FROM` are set (do it with hosting;
  Resend needs a domain you own to email anyone but yourself).
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
  data, CSV parsing, rules summary, start checks, results log/CSV,
  nomination slots / unavailable reasons, whose turn it is, commissioner edit text, the reveal timeline, the CSV photo column — 53 tests; the results log/CSV tests moved to the engine) are unit-tested; screens are verified by hand. No Playwright suite yet.
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
- **Commissioner roster edits are blocked during the make-up round**, and
  adding a player only fills a spot the team has open — by design, so no
  roster can end up over size. Edits aren't undoable; fix one with a
  counter-edit.

## What's left

League feedback on the walkthrough came back (2026-09-26): good, no notes —
no rule or settings changes needed.

In rough priority order:
1. **Hosting**, so phones can reach the app: pick a host (SPEC suggests
   Render / Railway / Fly.io, < ~$20/month) with the database in the same
   region (should also fix the bid-ack rush latency), production build,
   HTTPS, migrations on deploy, PWA manifest, and a mail provider for
   sign-in emails (DEV_LOGIN must stay off there). Needs the user's choice
   of host and whether they have a domain.
2. **A real mock draft with friends on phones** — SPEC's phase-3 "done when".
3. MFL import/export (phase 4), and the smaller gaps listed above.

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
  packages as of the player-photos commit. Note `pnpm run typecheck`
  checks the server against the engine's built `dist`, so run `pnpm run build`
  (or build the engine) first after changing engine types.
- Headless browser checks: Chrome is installed; `playwright-core` with
  `channel: "chrome"` works (install it in a scratch dir, not the repo).
- Local sign-in: with `DEV_LOGIN=true` in `apps/server/.env` the login
  page offers the no-check developer login (and the bot scripts'
  `/dev/session` works). Real sign-in codes appear in the server console.
- Demo drafts can now be set up through the UI (or POST /leagues + POST
  /invites/:code/claim) — no more direct `update team set user_id` needed.
- The session scratchpad holds `mock_draft.mjs` (full scripted run),
  `bots.mjs` (manual test bots), `walkthrough2.mjs` (demo draft +
  screenshots) — none are in the repo; check the useful ones in before
  relying on them.
- The Supabase dev DB from this session still has several leftover test
  leagues/drafts in it (named things like "Snake Demo League", "Nominate Demo
  League") — harmless, but worth a scoped cleanup pass (by league name, never
  an unscoped `DELETE`) before or during the Commissioner console work if it
  gets noisy.
