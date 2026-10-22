/**
 * Tenancy services: users ↔ organizations ↔ websites.
 * All functions take an explicit `Db` so they run against Postgres or PGlite.
 */
import { z } from "zod";
import { and, eq, isNull, inArray, or, exists, type SQL } from "drizzle-orm";
import {
  type Db,
  users,
  organizations,
  orgMembers,
  websites,
  websiteMembers,
  groupMembers,
  creditBalances,
  creditLedger,
  subscriptions,
} from "@athena/db";
import { ORG_WIDE_ROLES, type Permission } from "../org/rbac";
import { DomainError, ForbiddenError } from "../org/errors";
import { requirePermission } from "../org/access";
import { logActivity } from "../org/activity";

export const FREE_PLAN_CREDITS = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID_RE.test(v);

export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "org";
}

/** Normalise "https://www.Example.com/x" → "example.com". */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host = "";
  try {
    host = new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    host = "";
  }
  if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    throw new DomainError(`Invalid domain: ${input.slice(0, 100)}`);
  }
  return host;
}

const userInput = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  name: z.string().trim().max(120).optional().nullable(),
  image: z.string().url().optional().nullable(),
});

export interface EnsuredUser {
  user: typeof users.$inferSelect;
  organizationId: string;
  created: boolean;
}

async function uniqueSlug(db: Db, base: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 7)}`;
    const [hit] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, candidate));
    if (!hit) return candidate;
  }
  throw new Error("Could not allocate a unique organization slug");
}

/** Create a free-plan organization owned by `userId`, with starting credits. */
export async function createOrganization(db: Db, opts: { userId: string; name: string }): Promise<string> {
  const slug = await uniqueSlug(db, slugify(opts.name));
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: opts.name, slug }).returning();
    await tx.insert(orgMembers).values({ organizationId: org.id, userId: opts.userId, role: "owner" });
    await tx.insert(subscriptions).values({ organizationId: org.id, plan: "free", monthlyCredits: FREE_PLAN_CREDITS });
    await tx.insert(creditBalances).values({ organizationId: org.id, balance: FREE_PLAN_CREDITS });
    await tx.insert(creditLedger).values({
      organizationId: org.id,
      kind: "grant",
      amount: FREE_PLAN_CREDITS,
      reason: "Free plan monthly credits",
    });
    return org.id;
  });
}

/** Find or create the user by email; guarantees at least one organization membership. */
export async function ensureUserWithOrg(db: Db, input: z.input<typeof userInput>): Promise<EnsuredUser> {
  const data = userInput.parse(input);
  let created = false;
  let [user] = await db.select().from(users).where(eq(users.email, data.email));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email: data.email, name: data.name ?? null, image: data.image ?? null })
      .onConflictDoNothing()
      .returning();
    if (!user) [user] = await db.select().from(users).where(eq(users.email, data.email));
    else created = true;
  }
  const [membership] = await db
    .select({ organizationId: orgMembers.organizationId })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.organizationId))
    .where(and(eq(orgMembers.userId, user.id), isNull(organizations.deletedAt)))
    .limit(1);
  if (membership) return { user, organizationId: membership.organizationId, created };

  const orgName = data.name ? `${data.name}'s workspace` : `${data.email.split("@")[0]}'s workspace`;
  const organizationId = await createOrganization(db, { userId: user.id, name: orgName });
  return { user, organizationId, created };
}

export type WebsiteRow = typeof websites.$inferSelect;

/**
 * SQL condition selecting the websites a user may access:
 * owner/admin/billing → every website of the org; member/custom → websites
 * where they are a website member or a member of the website's group.
 */
async function accessibleWebsitesWhere(db: Db, userId: string): Promise<SQL | null> {
  const memberships = await db
    .select({ orgId: orgMembers.organizationId, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.organizationId))
    .where(and(eq(orgMembers.userId, userId), isNull(organizations.deletedAt)));
  if (!memberships.length) return null;
  const wide = memberships.filter((m) => ORG_WIDE_ROLES.has(m.role)).map((m) => m.orgId);
  const scoped = memberships.filter((m) => !ORG_WIDE_ROLES.has(m.role)).map((m) => m.orgId);
  const viaWebsite = exists(
    db
      .select({ one: websiteMembers.userId })
      .from(websiteMembers)
      .where(and(eq(websiteMembers.websiteId, websites.id), eq(websiteMembers.userId, userId))),
  );
  const viaGroup = exists(
    db
      .select({ one: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, websites.groupId), eq(groupMembers.userId, userId))),
  );
  const parts: SQL[] = [];
  if (wide.length) parts.push(inArray(websites.organizationId, wide));
  if (scoped.length) parts.push(and(inArray(websites.organizationId, scoped), or(viaWebsite, viaGroup)) as SQL);
  return and(isNull(websites.deletedAt), or(...parts)) as SQL;
}

/** Websites visible to the user (role/website/group scoped, non-deleted). */
export async function listWebsitesForUser(db: Db, userId: string): Promise<WebsiteRow[]> {
  if (!isUuid(userId)) return [];
  const where = await accessibleWebsitesWhere(db, userId);
  if (!where) return [];
  return db.select().from(websites).where(where).orderBy(websites.createdAt);
}

/** Returns the website only when the user may access it (else null). */
export async function getWebsiteForUser(db: Db, userId: string, websiteId: string): Promise<WebsiteRow | null> {
  if (!isUuid(websiteId) || !isUuid(userId)) return null;
  const where = await accessibleWebsitesWhere(db, userId);
  if (!where) return null;
  const [site] = await db.select().from(websites).where(and(eq(websites.id, websiteId), where));
  return site ?? null;
}

const websiteInput = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  domain: z.string().min(3).max(253),
  name: z.string().trim().min(1).max(120),
  groupId: z.string().uuid().optional().nullable(),
});

export async function createWebsite(db: Db, input: z.input<typeof websiteInput>): Promise<WebsiteRow> {
  const data = websiteInput.parse(input);
  const domain = normalizeDomain(data.domain);
  await requirePermission(db, data.userId, data.organizationId, "websites:write");
  const [dup] = await db
    .select({ id: websites.id })
    .from(websites)
    .where(and(eq(websites.organizationId, data.organizationId), eq(websites.domain, domain), isNull(websites.deletedAt)));
  if (dup) throw new DomainError(`${domain} is already tracked in this organization`);
  return db.transaction(async (tx) => {
    const [site] = await tx
      .insert(websites)
      .values({ organizationId: data.organizationId, groupId: data.groupId ?? null, domain, name: data.name })
      .returning();
    await tx.insert(websiteMembers).values({ websiteId: site.id, userId: data.userId, role: "owner" });
    await logActivity(tx, {
      organizationId: data.organizationId,
      userId: data.userId,
      websiteId: site.id,
      entityType: "website",
      entityId: site.id,
      change: "created",
      after: { name: site.name, domain: site.domain },
    });
    return site;
  });
}

/** First (oldest) organization the user belongs to, or null. */
export async function getPrimaryOrganizationId(db: Db, userId: string): Promise<string | null> {
  if (!isUuid(userId)) return null;
  const [row] = await db
    .select({ id: orgMembers.organizationId })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.organizationId))
    .where(and(eq(orgMembers.userId, userId), isNull(organizations.deletedAt)))
    .orderBy(orgMembers.createdAt)
    .limit(1);
  return row?.id ?? null;
}

/**
 * The website if the user can access it AND holds `permission` in its
 * organization; otherwise ForbiddenError (no distinction, to avoid leaking existence).
 */
export async function requireWebsitePermission(
  db: Db,
  userId: string,
  websiteId: string,
  permission: Permission,
): Promise<WebsiteRow> {
  const site = await getWebsiteForUser(db, userId, websiteId);
  if (!site) throw new ForbiddenError();
  await requirePermission(db, userId, site.organizationId, permission);
  return site;
}
