import { and, desc, eq, sql } from "drizzle-orm";
import { type Db, activityLog, users } from "@athena/db";
import { requirePermission } from "./access";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface ActivityInput {
  organizationId: string;
  userId: string | null;
  websiteId?: string | null;
  entityType: string;
  entityId?: string | null;
  change: string;
  before?: unknown;
  after?: unknown;
}

/** Append an audit entry (call inside the same transaction as the change). */
export async function logActivity(db: Db | Tx, input: ActivityInput): Promise<void> {
  await db.insert(activityLog).values({
    organizationId: input.organizationId,
    userId: input.userId,
    websiteId: input.websiteId ?? null,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    change: input.change,
    before: input.before ?? null,
    after: input.after ?? null,
  });
}

export interface ActivityRow {
  id: string;
  entityType: string;
  entityId: string | null;
  change: string;
  before: unknown;
  after: unknown;
  actorEmail: string | null;
  createdAt: Date;
}

export async function listActivity(
  db: Db,
  opts: { actorId: string; organizationId: string; limit?: number; /** id of the last row of the previous page */ cursor?: string },
): Promise<ActivityRow[]> {
  await requirePermission(db, opts.actorId, opts.organizationId, "activity:read");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const validCursor = opts.cursor && /^[0-9a-f-]{36}$/i.test(opts.cursor) ? opts.cursor : undefined;
  // keyset pagination on (created_at, id) using the cursor row's exact DB values
  // (JS Dates drop Postgres' microseconds, which would skip rows)
  const where = validCursor
    ? and(
        eq(activityLog.organizationId, opts.organizationId),
        sql`(${activityLog.createdAt}, ${activityLog.id}) < (select c.created_at, c.id from activity_log c where c.id = ${validCursor} and c.organization_id = ${opts.organizationId})`,
      )
    : eq(activityLog.organizationId, opts.organizationId);
  return db
    .select({
      id: activityLog.id,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      change: activityLog.change,
      before: activityLog.before,
      after: activityLog.after,
      actorEmail: users.email,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.userId))
    .where(where)
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(limit);
}
