# UI Spec — Draft Day Screens (phase 3)

Approved Sep 25, 2026. This file describes the look and behavior of every draft-day screen. The HTML mockups in `design/mockups/` are the visual reference: match their layout, sizes and colors, but build real React components wired to the server (the mockups use sample data and a mockup runtime; do not copy their `<x-dc>`, `<sc-for>` or `support.js` markup).

Rules and data come from `SPEC.md`. If this file and SPEC.md disagree on a rule, SPEC.md wins; ask before changing either.

## Look

"Stadium at night": dark green ground, chalk-white text, scoreboard amber for anything you act on or that is live. Dark theme only.

| Token | Hex | Used for |
| --- | --- | --- |
| `bg` | `#0F1712` | Page background |
| `surface` | `#17221B` | Cards, panels, list rows |
| `surface-2` | `#1F2D24` | Keypad keys, steppers, roster tiles |
| `surface-sunk` | `#121C15` | Inside the bid amount field |
| `line` | `#2C3D31` | Borders, dividers, outline buttons |
| `line-dashed` | `#4A5E50` | Dashed outline for "not yet" states |
| `chip` | `#2A3B2F` | Position chips, highlighted row |
| `text` | `#EEF2EA` | Primary text |
| `muted` | `#A7B6A9` | Secondary text, labels |
| `accent` | `#F2B84B` | Primary buttons, clock, live lot, "has bid" tiles |
| `on-accent` | `#1A1405` | Text on amber |
| `success` | `#8FD6A8` on `#13241A`, border `#3E7A55` | "Your bid is in", connected |
| `warn` | `#FF9A7A` on `#2A1812`, border `#6B3A2C` | Ties, broke teams, offline, undo, errors |

Type:
- **Display:** Big Shoulders Display 700/800, uppercase for player names, used for the clock, dollar amounts and big numbers.
- **Body:** Barlow 400/500/600/700 for everything else.
- Section labels: 13px, 700, uppercase, letter-spacing 0.06em, `muted`.

Shape and spacing: radius 10–14px on controls, 16–24px on panels; phone gutter 16px; gaps 8–16px. Touch targets at least 44px tall.

Never show state by color alone: "has bid" tiles also carry the team number and a solid vs dashed style, broke teams also say "broke", disabled picks also say why.

## Layouts by device

The same screens and rules on every device; only the layout changes.

- **Phone (< 768px):** one column, as in the phone mockups. Bid entry uses the on-screen keypad.
- **Laptop (≥ 1024px):** three columns, as in `BidLaptop`: round lots on the left, live lot and your bid in the middle, all teams on the right. Bids are typed in a numeric field and submitted with Enter; no keypad. `/` focuses player search.
- **Big board (TV, `/board/:draftId`):** read-only spectator view, 16:9, sized for reading across a room; no login beyond the league's board link.

## Screens

### 1. Nominate (`Nominate.dc.html`)
- Amber "You're on the clock" banner with the nomination clock.
- Player search field plus position filter pills: All, QB, RB, WR/TE, K, DEF.
- Available players list: position, name, NFL team, bye week, amber Nominate button.
- "This round so far" panel listing lots nominated this round and by whom, with the round's direction (1 → 12 or 12 → 1).
- Everyone not nominating sees the same header with "Team N is nominating…" instead of the banner.

### 2. Bid — phone (`Main.dc.html`, working prototype)
- Header: round, lot number, who nominated.
- Player card with a countdown ring and time left.
- Three stat tiles: budget left, auction spots filled, your count at this player's position vs its max.
- Amount field (display font, amber border) with "Min $5 · max $[budget]".
- 3×4 keypad: 1–9, Clear, 0, Delete. Large amber "Lock in sealed bid" button.
- Client-side hints for under-minimum and over-budget; the server's error code is still the final word (`BID_TOO_LOW`, `OVER_BUDGET`, `POSITION_LIMIT`, `LOT_CLOSED`).
- After submitting: green "Your bid is in and hidden" panel showing your amount and a "Change bid" button until the clock ends.
- Bottom strip: "N of M have bid" and one tile per team — solid amber with the number if they've bid, dashed if not, dimmed "out" if not eligible for this lot. Never an amount.
- Not eligible (full, broke, or at position max): keypad disabled with the reason.

### 2b. Bid — laptop (`BidLaptop.dc.html`, working prototype)
- Left: this round's lots — sold ones dimmed with winner and price, live one highlighted, the next one marked.
- Middle: player card with countdown ring; typed bid field with "Lock in bid" button and "Type an amount and press Enter"; the same submitted state and bid-status strip as phone; your roster panel (auction spots used, money spent, count at this position).
- Right: every team's max bid, spots filled and count at the live lot's position; teams that can't bid on this player are greyed with the reason; your row highlighted; broke teams in warn color.

### 3. Reveal (`Reveal.dc.html`)
- All screens flip at the same moment on `lot:reveal`.
- Amber winner card: team number and name, price in large display type.
- Runner-up rows as allowed by the reveal setting (default 2), then "N other bids stay hidden".
- Tiles showing the winner's budget before → after and auction spots now filled.
- "Up next" card with the next lot and a short countdown.

### 4. Tie re-bid (`TieRebid.dc.html`)
- Warn-colored banner "You're still tied" with who you're tied with, the amount, and the tie clock.
- "How we got here": original tie amount, then each re-bid round's amounts (everyone sees these), knocked-out teams struck through.
- Re-bid field with −/+ $5 steppers and quick buttons +$5, +$10, +$25, +$50; label shows the minimum allowed (previous bid + tie raise) and budget.
- Note that your previous bid stands if you don't re-bid in time.
- Teams not in the tie see "Tie-break in progress" with the tied teams and the clock.

### 5. Snake pick (`SnakePick.dc.html`)
- Header: snake round and overall pick number; amber on-the-clock banner with the next three teams.
- "You still need" chips from the position limits (e.g. "QB · 1", "K · 2", "WR/TE · full").
- Tabs: Available, My queue (count), Board.
- Search field and position filter pills (same as Nominate).
- Player rows with a Draft button; players the team can't take are greyed with the reason ("You already have 7 of 7 WR/TE") and a disabled button.
- Footer note on auto-pick when the clock runs out.
- Board tab: rounds × teams grid with the pick on the clock highlighted.

### 6. Commissioner console (`Commish.dc.html`)
- Status line: phase, round, lot, clock.
- Large amber Pause (becomes Resume) and +15 seconds.
- Timed break: 5, 10, 15, 30 minutes.
- Clock lengths with −/+ steppers for nominate, bid, tie re-bid and snake pick; note "Apply from the next lot".
- Undo last result, in warn style, naming exactly what it undoes; confirm before acting.
- Who's connected: one tile per team, offline teams in warn style with a mark and a count.
- Never any control to bid, nominate or pick for another team; never shows sealed bid amounts.

### 7. Big board — TV (`BigBoard.dc.html`)
- Header: league name and draft; phase, round, "Lot X of Y".
- Live lot: position chip, player name very large, who nominated, and a very large clock.
- "N of M have bid" strip with one tile per team, same meaning as the phone strip; ineligible teams show "out".
- Round lots grid (6 per row): every lot in this round — sold (dimmed, winner and price), bidding now (amber), up next (amber outline), upcoming (player, position, nominator). Note any team that skipped nominating (full or broke) and the next round's direction.
- Right column: every team's money left and auction spots filled; broke teams in warn color with "broke".
- During reveals it shows the reveal card; during a break, a full-screen break countdown; in the snake phase, the snake board with the team on the clock.

## States every screen must handle
- **Paused / break:** a banner "Draft paused" or a break countdown; all inputs disabled; clocks frozen.
- **Reconnecting:** a small banner "Reconnecting…"; inputs disabled until the snapshot arrives.
- **Not your turn / not eligible:** controls disabled with the reason in words.
- **Last 10 seconds:** clock turns warn color; optional sound/vibration (FR-20).

## Accessibility
- Real `<button>`, `<input>` and `<label>` elements; icon-only buttons have `aria-label`.
- The clock has a screen-reader label; time-left announcements at 30 s and 10 s via a polite live region, not every second.
- Text contrast at least 4.5:1 (all tokens above meet it on `bg` and `surface`).
