import { CLOCK_RANGES_SEC, type Action, type ClockName, type Ctx, type ErrorCode } from "@draft-app/engine";
import type { Socket } from "socket.io";
import { z } from "zod";
import type { EngineRuntime } from "../engine/engineRuntime.js";
import { assertCommissioner, findOwnedTeamId, ForbiddenError } from "../http/authz.js";
import type { SocketData } from "./types.js";

type Ack = ((response: { ok: true } | { ok: false; code: ErrorCode | "FORBIDDEN" | "NOT_JOINED" | "INVALID_PAYLOAD" | "SERVER_ERROR"; message: string }) => void) | undefined;

/** A clock length within SPEC.md's allowed range for that clock, or "off". */
function clockSettingSchema(clock: ClockName) {
  const { min, max } = CLOCK_RANGES_SEC[clock];
  return z.union([z.number().int().min(min).max(max), z.literal("off")]);
}

const schemas = {
  nominate: z.object({ playerId: z.string() }),
  "bid:submit": z.object({ lotId: z.string(), amount: z.number().int() }),
  "tie:rebid": z.object({ lotId: z.string(), amount: z.number().int() }),
  "pick:make": z.object({ playerId: z.string() }),
  "admin:start": z.object({}),
  "admin:pause": z.object({}),
  "admin:resume": z.object({}),
  "admin:break": z.object({ minutes: z.number().int().positive() }),
  "admin:undo": z.object({}),
  "admin:addTime": z.object({ seconds: z.number().int().positive() }),
  "admin:setClocks": z.object({
    nomination: clockSettingSchema("nomination").optional(),
    bid: clockSettingSchema("bid").optional(),
    tie: clockSettingSchema("tie").optional(),
    pick: clockSettingSchema("pick").optional(),
  }),
  "admin:setRevealTopN": z.object({ revealTopN: z.union([z.number().int().positive(), z.literal("all")]) }),
  "admin:resolveTie": z.object({ lotId: z.string(), teamId: z.string() }),
  "admin:voidLot": z.object({ lotId: z.string() }),
  "admin:markPlayerUnavailable": z.object({ playerId: z.string() }),
} as const;

const TEAM_SCOPED_EVENTS = new Set(["nominate", "bid:submit", "tie:rebid", "pick:make"]);
const ADMIN_EVENTS = new Set([
  "admin:start",
  "admin:pause",
  "admin:resume",
  "admin:break",
  "admin:undo",
  "admin:addTime",
  "admin:setClocks",
  "admin:setRevealTopN",
  "admin:resolveTie",
  "admin:voidLot",
  "admin:markPlayerUnavailable",
]);

function data(socket: Socket): SocketData {
  return socket.data as SocketData;
}

async function dispatch(runtime: EngineRuntime, socket: Socket, action: Action, ack: Ack): Promise<void> {
  const draftId = data(socket).draftId;
  if (!draftId) {
    ack?.({ ok: false, code: "NOT_JOINED", message: "Join a draft before sending intents." });
    return;
  }
  const ctx: Ctx = { now: Date.now(), rng: Math.random };

  let result: Awaited<ReturnType<typeof runtime.applyAction>>;
  try {
    result = await runtime.applyAction(draftId, action, ctx, data(socket).userId);
  } catch (err) {
    // A DB failure never leaves the caller's ack hanging, and is reported as
    // a distinct server error — never an engine ErrorCode, since the action
    // wasn't rejected by a rule, the infrastructure just failed.
    console.error("applyAction failed", err);
    ack?.({ ok: false, code: "SERVER_ERROR", message: "The server failed to process this action." });
    return;
  }

  if (result.rejected) {
    ack?.({ ok: false, code: result.code, message: result.message });
    return;
  }
  ack?.({ ok: true });
  // Broadcasting itself happens inside runtime.applyAction via the
  // broadcaster set by buildServer — the same path clock-driven expiries
  // use, so every state change reaches clients exactly once regardless of
  // whether a WS intent or a timer caused it.
}

/** Registers one handler per SPEC.md WS intent (plus the engine's admin:voidLot/markPlayerUnavailable/setRevealTopN, not in SPEC's table but real engine actions). */
export function registerIntentHandlers(runtime: EngineRuntime, socket: Socket): void {
  const db = runtime.db;
  for (const [event, schema] of Object.entries(schemas)) {
    socket.on(event, async (payload: unknown, ack: Ack) => {
      const parsed = schema.safeParse(payload ?? {});
      if (!parsed.success) {
        ack?.({ ok: false, code: "INVALID_PAYLOAD", message: parsed.error.message });
        return;
      }

      // Everything below can throw (DB lookups, etc.) — never let an
      // unexpected exception leave the caller's ack uncalled and hanging.
      try {
        if (TEAM_SCOPED_EVENTS.has(event)) {
          const leagueId = data(socket).leagueId;
          const cached = data(socket).teamId;
          const teamId = cached !== undefined ? cached : leagueId ? await findOwnedTeamId(db, data(socket).userId, leagueId) : null;
          if (!teamId) {
            ack?.({ ok: false, code: "FORBIDDEN", message: "You don't own a team in this league." });
            return;
          }
          const action = { type: event, teamId, ...parsed.data } as Action;
          await dispatch(runtime, socket, action, ack);
          return;
        }

        if (ADMIN_EVENTS.has(event)) {
          const leagueId = data(socket).leagueId;
          if (!leagueId) {
            ack?.({ ok: false, code: "NOT_JOINED", message: "Join a draft before sending intents." });
            return;
          }
          if (data(socket).isCommissioner === false) throw new ForbiddenError("Only the league commissioner can do this.");
          if (data(socket).isCommissioner === undefined) await assertCommissioner(db, data(socket).userId, leagueId);
          const action = { type: event, ...parsed.data } as Action;
          await dispatch(runtime, socket, action, ack);
        }
      } catch (err) {
        if (err instanceof ForbiddenError) {
          ack?.({ ok: false, code: "FORBIDDEN", message: err.message });
          return;
        }
        console.error(`intent handler failed for ${event}`, err);
        ack?.({ ok: false, code: "SERVER_ERROR", message: "The server failed to process this action." });
      }
    });
  }
}
