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
  const client = postgres(databaseUrl, { max: 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

export type Db = ReturnType<typeof createDb>["db"];
