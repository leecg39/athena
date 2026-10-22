/** Apply SQL migrations to DATABASE_URL. Run: npm run db:migrate */
import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getDb, closeDb } from "./client";

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

migrate(getDb() as never, { migrationsFolder: folder })
  .then(async () => {
    process.stdout.write("migrations applied\n");
    await closeDb();
  })
  .catch(async (err: unknown) => {
    process.stderr.write(`migration failed: ${String(err)}\n`);
    await closeDb();
    process.exit(1);
  });
