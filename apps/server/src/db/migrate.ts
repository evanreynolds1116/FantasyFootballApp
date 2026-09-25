import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

async function main() {
  const { db, client } = createDb();
  await migrate(db, { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
