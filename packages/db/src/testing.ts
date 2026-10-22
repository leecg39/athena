/**
 * In-process Postgres (PGlite) for tests: fresh database with all migrations applied.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as schema from "./schema/index";
import type { Db } from "./client";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

export interface TestDb {
  db: Db;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const pdb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(pdb, { migrationsFolder: MIGRATIONS });
  return { db: pdb as unknown as Db, close: () => client.close() };
}
