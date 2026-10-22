/** Re-run extraction for one website (or all): `npm run reanalyze -w @athena/jobs -- [websiteId]` */
import "dotenv/config";
import { isNull } from "drizzle-orm";
import { getDb, closeDb, websites } from "@athena/db";
import { reanalyzeResponses, backfillCitationColumns } from "../src/collection";

const db = getDb();
process.stdout.write(`citations backfilled: ${await backfillCitationColumns(db)}\n`);
const target = process.argv[2];
const ids = target ? [target] : (await db.select({ id: websites.id }).from(websites).where(isNull(websites.deletedAt))).map((w) => w.id);
for (const id of ids) process.stdout.write(`${id}: ${await reanalyzeResponses(db, { websiteId: id })} responses re-analyzed\n`);
await closeDb();
