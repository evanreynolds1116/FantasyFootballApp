import type { Action, Ctx, ErrorCode } from "@draft-app/engine";
import type { Server, Socket } from "socket.io";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { assertCommissioner, findOwnedTeamId } from "../http/authz.js";
import { applyAction } from "../engine/activeDraftRegistry.js";
import { broadcastEvents } from "./broadcastEvents.js";
import type { SocketData } from "./types.js";

type Ack = ((response: { ok: true } | { ok: false; code: ErrorCode | "FORBIDDEN" | "NOT_JOINED" | "INVALID_PAYLOAD"; message: string }) => void) | undefined;

const clockSettingSchema = z.union([z.number().int().positive(), z.literal("off")]);

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
    nomination: clockSettingSchema.optional(),
    bid: clockSettingSchema.optional(),
    tie: clockSettingSchema.optional(),
    pick: clockSettingSchema.optional(),
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

async function dispatch(io: Server, db: Db, socket: Socket, action: Action, ack: Ack): Promise<void> {
  const draftId = data(socket).draftId;
  if (!draftId) {
    ack?.({ ok: false, code: "NOT_JOINED", message: "Join a draft before sending intents." });
    return;
  }
  const ctx: Ctx = { now: Date.now(), rng: Math.random };
  const result = await applyAction(db, draftId, action, ctx, data(socket).userId);
  if (result.rejected) {
    ack?.({ ok: false, code: result.code, message: result.message });
    return;
  }
  ack?.({ ok: true });
  broadcastEvents(io, draftId, result.state, result.events);
}

/** Registers one handler per SPEC.md WS intent (plus the engine's admin:voidLot/markPlayerUnavailable/setRevealTopN, not in SPEC's table but real engine actions). */
export function registerIntentHandlers(io: Server, db: Db, socket: Socket): void {
  for (const [event, schema] of Object.entries(schemas)) {
    socket.on(event, async (payload: unknown, ack: Ack) => {
      const parsed = schema.safeParse(payload ?? {});
      if (!parsed.success) {
        ack?.({ ok: false, code: "INVALID_PAYLOAD", message: parsed.error.message });
        return;
      }

      if (TEAM_SCOPED_EVENTS.has(event)) {
        const leagueId = data(socket).leagueId;
        const teamId = leagueId ? await findOwnedTeamId(db, data(socket).userId, leagueId) : null;
        if (!teamId) {
          ack?.({ ok: false, code: "FORBIDDEN", message: "You don't own a team in this league." });
          return;
        }
        const action = { type: event, teamId, ...parsed.data } as Action;
        await dispatch(io, db, socket, action, ack);
        return;
      }

      if (ADMIN_EVENTS.has(event)) {
        const leagueId = data(socket).leagueId;
        if (!leagueId) {
          ack?.({ ok: false, code: "NOT_JOINED", message: "Join a draft before sending intents." });
          return;
        }
        try {
          await assertCommissioner(db, data(socket).userId, leagueId);
        } catch {
          ack?.({ ok: false, code: "FORBIDDEN", message: "Commissioner-only action." });
          return;
        }
        const action = { type: event, ...parsed.data } as Action;
        await dispatch(io, db, socket, action, ack);
      }
    });
  }
}
