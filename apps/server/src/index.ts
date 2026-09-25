import { buildServer } from "./buildServer.js";
import { bootstrapScheduler } from "./scheduler/timerScheduler.js";
import { roomForDraft } from "./ws/broadcastEvents.js";

async function main() {
  const app = await buildServer();
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen({ port, host: "0.0.0.0" });

  const recovered = await bootstrapScheduler(app.db);
  for (const r of recovered) {
    app.io.to(roomForDraft(r.draftId)).emit("draft:recovered", r);
    app.log.warn({ recovered: r }, "Draft clock extended after server downtime");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
