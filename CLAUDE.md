# Draft App — project notes for Claude Code

Real-time web app for a closed (sealed-bid) auction + snake fantasy football draft. The full spec is in `SPEC.md` — read it before making changes; it is the source of truth for rules. If code and spec disagree, ask before changing either.

## Stack
- TypeScript everywhere, pnpm workspaces monorepo:
  - `packages/engine` — pure rules engine, no I/O
  - `apps/server` — Node + Fastify + Socket.IO + Postgres (Drizzle)
  - `apps/web` — React + Vite + Tailwind PWA
- Tests: Vitest (engine + server), Playwright (multi-browser draft simulations)

## Non-negotiable rules
- The server is authoritative. Clients send intents; only the server decides outcomes and time.
- The engine is pure: `(state, action) → { state, events }`. Inject the clock and random source; never call `Date.now()` or `Math.random()` inside the engine.
- Bid amounts never leave the server before reveal — not to the commissioner, not in logs sent to clients. Keep a test that inspects every outgoing message for this.
- Nobody (including the commissioner) can nominate, bid or pick for another team.
- Persist every state change before broadcasting it.
- Every rule and edge case in SPEC.md gets a unit test in `packages/engine`.

## Workflow
- Build in the phase order from SPEC.md; finish and test the engine before any UI.
- Run `pnpm test` before calling any task done.
- Keep league defaults (12 teams, $1,000, 8 auction spots, 17-man roster, $5 min bid, $5 tie raise, snake nominations) in one settings default file.
