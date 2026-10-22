/** Which schedules are due for a collection run. */
import { and, eq, isNull, sql } from "drizzle-orm";
import { type Db, promptSchedules, websites, organizations } from "@athena/db";

export const CADENCE_MS: Record<string, number> = {
  daily: 86_400_000,
  every_3_days: 3 * 86_400_000,
  weekly: 7 * 86_400_000,
};

/** small tolerance so a cron tick slightly early still counts */
const SLACK_MS = 10 * 60_000;

export interface DueSchedule {
  id: string;
  websiteId: string;
  cadence: string;
}

export async function dueSchedules(db: Db, now = new Date()): Promise<DueSchedule[]> {
  const rows = await db
    .select({
      id: promptSchedules.id,
      websiteId: promptSchedules.websiteId,
      cadence: promptSchedules.cadence,
      lastRun: sql<Date | null>`(select max(r.created_at) from runs r where r.schedule_id = "prompt_schedules"."id")`,
    })
    .from(promptSchedules)
    .innerJoin(websites, eq(websites.id, promptSchedules.websiteId))
    .innerJoin(organizations, eq(organizations.id, websites.organizationId))
    .where(and(isNull(promptSchedules.archivedAt), isNull(websites.deletedAt), isNull(organizations.deletedAt)));
  return rows
    .filter((r) => {
      const interval = CADENCE_MS[r.cadence];
      if (!interval) return false;
      if (!r.lastRun) return true;
      return now.getTime() - new Date(r.lastRun).getTime() >= interval - SLACK_MS;
    })
    .map(({ id, websiteId, cadence }) => ({ id, websiteId, cadence }));
}
