import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy apps/server/.env.example to .env and fill it in.");
  }
  return url;
}

export function createDb(databaseUrl: string = requireDatabaseUrl()) {
  // Kept small deliberately: Supabase's session-mode pooler caps total
  // concurrent connections (15 on the free tier), and multiple server
  // instances (e.g. one per integration test file) each open their own pool.
  const client = postgres(databaseUrl, { max: 3 });
  const db = drizzle(client, { schema });
  return { db, client };
}

export type Db = ReturnType<typeof createDb>["db"];
