import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema/index";

export type Schema = typeof schema;
/** Driver-agnostic database handle (node-postgres in the app, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

const globalForDb = globalThis as unknown as { __athenaDb?: Db; __athenaPool?: Pool };

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Configure a Postgres connection string to use the database.");
  }
  return url;
}

/** Lazily create (once per process) the node-postgres backed database. */
export function getDb(): Db {
  if (!globalForDb.__athenaDb) {
    const pool = new Pool({ connectionString: databaseUrl(), max: 10 });
    globalForDb.__athenaPool = pool;
    globalForDb.__athenaDb = drizzle(pool, { schema, casing: "snake_case" }) as unknown as Db;
  }
  return globalForDb.__athenaDb;
}

/** Close the shared pool (scripts / graceful shutdown). */
export async function closeDb(): Promise<void> {
  await globalForDb.__athenaPool?.end();
  globalForDb.__athenaPool = undefined;
  globalForDb.__athenaDb = undefined;
}

/**
 * Proxy that resolves the real database on first property access, so importing
 * this module never requires DATABASE_URL (e.g. during `next build`).
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});
