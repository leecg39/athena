import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const globalForDb = globalThis as unknown as {
  __athenaPool?: Pool;
};

/**
 * Lazy Postgres pool. Throws only when actually queried without DATABASE_URL,
 * so the package can be imported (and built) in environments without a DB.
 */
function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Configure a Postgres connection string to use the database.",
    );
  }
  if (!globalForDb.__athenaPool) {
    globalForDb.__athenaPool = new Pool({ connectionString: url, max: 10 });
  }
  return globalForDb.__athenaPool;
}

export const db = drizzle(getPool, { schema });

export { schema };
export * from "./schema.js";
