import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // `prepare: false` keeps us compatible with transaction-mode poolers
  // (Neon, Supabase, PgBouncer) in production.
  // Notices ("truncate cascades to...", "already exists, skipping") are informational.
  return postgres(url, { max: 10, prepare: false, onnotice: () => {} });
}

// Reuse the connection pool across hot reloads in development.
const client = globalForDb.pgClient ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema, casing: "snake_case" });
export type DB = typeof db;
export { schema };
