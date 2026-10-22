import { z } from "zod";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { type Db, apiKeys, organizations } from "@athena/db";
import { requirePermission } from "./access";
import { logActivity } from "./activity";
import { NotFoundError } from "./errors";

export const API_KEY_PREFIX = "ath_";

export const hashApiKey = (key: string): string => createHash("sha256").update(key).digest("hex");

const createInput = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
});

/** Create a key. The plaintext is returned exactly once; only its SHA-256 is stored. */
export async function createApiKey(db: Db, input: z.input<typeof createInput>) {
  const data = createInput.parse(input);
  await requirePermission(db, data.actorId, data.organizationId, "api:manage");
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  const record = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(apiKeys)
      .values({ organizationId: data.organizationId, name: data.name, hashedKey: hashApiKey(key), prefix: key.slice(0, 10) })
      .returning();
    await logActivity(tx, {
      organizationId: data.organizationId,
      userId: data.actorId,
      entityType: "api_key",
      entityId: row.id,
      change: "created",
      after: { name: row.name, prefix: row.prefix },
    });
    return row;
  });
  return { key, record };
}

export async function listApiKeys(db: Db, opts: { actorId: string; organizationId: string }) {
  await requirePermission(db, opts.actorId, opts.organizationId, "api:manage");
  return db
    .select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt })
    .from(apiKeys)
    .where(eq(apiKeys.organizationId, opts.organizationId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(db: Db, input: { actorId: string; organizationId: string; keyId: string }) {
  await requirePermission(db, input.actorId, input.organizationId, "api:manage");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, input.keyId), eq(apiKeys.organizationId, input.organizationId), isNull(apiKeys.revokedAt)))
      .returning();
    if (!row) throw new NotFoundError("Active API key not found");
    await logActivity(tx, {
      organizationId: input.organizationId,
      userId: input.actorId,
      entityType: "api_key",
      entityId: row.id,
      change: "revoked",
      before: { name: row.name, prefix: row.prefix },
    });
  });
}

/** Resolve a presented key to its organization, or null (unknown, revoked, or org deleted). */
export async function verifyApiKey(db: Db, presented: string): Promise<{ organizationId: string; keyId: string } | null> {
  if (!presented.startsWith(API_KEY_PREFIX) || presented.length > 200) return null;
  const hash = hashApiKey(presented);
  const [row] = await db
    .select({ id: apiKeys.id, organizationId: apiKeys.organizationId, hashedKey: apiKeys.hashedKey })
    .from(apiKeys)
    .innerJoin(organizations, eq(organizations.id, apiKeys.organizationId))
    .where(and(eq(apiKeys.hashedKey, hash), isNull(apiKeys.revokedAt), isNull(organizations.deletedAt)));
  if (!row) return null;
  // constant-time confirmation of the indexed match
  if (!timingSafeEqual(Buffer.from(row.hashedKey), Buffer.from(hash))) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return { organizationId: row.organizationId, keyId: row.id };
}
