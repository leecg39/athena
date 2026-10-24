/**
 * Agency groups (Task 19): multi-website rollups from collected answers,
 * group saved views and a shared group credit pool (credits move between the
 * organization pool and a group pool; none are created here).
 */
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { type Db, creditBalances, creditLedger, groups, prompts, responseMentions, responses, savedViews, websites } from "@athena/db";
import { requireMember, requirePermission } from "../org/access";
import { logActivity } from "../org/activity";
import { DomainError, NotFoundError } from "../org/errors";
import { listWebsitesForUser } from "../tenancy";
import { visibilityForSite, searchValueForSite } from "../analytics/visibility";

export interface GroupWebsiteMetricRow {
  id: string;
  name: string;
  domain: string;
  activePromptsCount: number;
  totalResponses: number;
  /** null when no answers were collected in the period */
  mentionRatePct: number | null;
  citationRatePct: number | null;
  sovPct: number | null;
  /** search volume of tracked prompts weighted by mention rate; null without volume data */
  aiVisibleSearches: number | null;
}

export interface GroupCreditLedgerItem {
  id: string;
  kind: string;
  amount: number;
  reason: string | null;
  websiteId: string | null;
  websiteName: string | null;
  groupId: string | null;
  createdAt: Date;
}

export interface GroupDashboardData {
  group: { id: string; organizationId: string; name: string; createdAt: Date };
  allGroups: { id: string; name: string; websiteCount: number }[];
  memberWebsites: GroupWebsiteMetricRow[];
  availableWebsites: { id: string; name: string; domain: string; groupId: string | null }[];
  /** collected answers in the last `periodDays` days */
  periodDays: number;
  kpis: {
    websiteCount: number;
    groupMentionRatePct: number | null;
    groupCitationRatePct: number | null;
    groupSovPct: number | null;
    totalAiVisibleSearches: number | null;
    totalActivePrompts: number;
    totalResponses: number;
  };
  competitorSovRollup: { name: string; isOwn: boolean; mentions: number; sovPct: number }[];
  savedViews: { id: string; name: string; filters: Record<string, unknown>; createdAt: Date }[];
  billing: { orgUnallocatedBalance: number; groupSharedBalance: number; totalGroupConsumedCredits: number; ledger: GroupCreditLedgerItem[] };
}

/**
 * The organization's first group, created (empty of credits) on first use so
 * /group has something to show; unassigned websites join it.
 */
export async function ensureDefaultGroup(db: Db, opts: { actorId: string; organizationId: string }): Promise<{ id: string; name: string }> {
  await requireMember(db, opts.actorId, opts.organizationId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"default_group:" + opts.organizationId}))`);
    const [existing] = await tx.select().from(groups).where(and(eq(groups.organizationId, opts.organizationId), isNull(groups.deletedAt))).orderBy(asc(groups.createdAt)).limit(1);
    if (existing) return { id: existing.id, name: existing.name };
    const [created] = await tx.insert(groups).values({ organizationId: opts.organizationId, name: "Core Brand Portfolio" }).returning();
    await tx.update(websites).set({ groupId: created!.id }).where(and(eq(websites.organizationId, opts.organizationId), isNull(websites.groupId), isNull(websites.deletedAt)));
    return { id: created!.id, name: created!.name };
  });
}

/** Read-only: the organization's first group, if any. */
export async function findDefaultGroup(db: Db, opts: { actorId: string; organizationId: string }): Promise<{ id: string; name: string } | null> {
  await requireMember(db, opts.actorId, opts.organizationId);
  const [row] = await db.select({ id: groups.id, name: groups.name }).from(groups).where(and(eq(groups.organizationId, opts.organizationId), isNull(groups.deletedAt))).orderBy(asc(groups.createdAt)).limit(1);
  return row ?? null;
}

const PERIOD_DAYS = 30;
const DAY = 86_400_000;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

type SiteRow = typeof websites.$inferSelect;
interface SiteMetrics {
  row: GroupWebsiteMetricRow;
  mentioned: number;
  cited: number;
  entities: { name: string; isOwn: boolean; mentions: number }[];
}

async function siteMetrics(db: Db, site: SiteRow, from: Date, to: Date): Promise<SiteMetrics> {
  const filters = { from, to };
  const [[counts], [promptCnt], visibility, value] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int`, mentioned: sql<number>`count(*) filter (where ${responses.mentioned})::int`, cited: sql<number>`count(*) filter (where ${responses.cited})::int` })
      .from(responses)
      .where(and(eq(responses.websiteId, site.id), gte(responses.ranAt, from), lt(responses.ranAt, to))),
    db.select({ n: sql<number>`count(*)::int` }).from(prompts).where(and(eq(prompts.websiteId, site.id), isNull(prompts.deletedAt))),
    visibilityForSite(db, site, filters),
    searchValueForSite(db, site, filters),
  ]);
  const n = Number(counts?.n ?? 0);
  const mentioned = Number(counts?.mentioned ?? 0);
  const cited = Number(counts?.cited ?? 0);
  return {
    mentioned,
    cited,
    entities: n ? visibility.entities.map((e) => ({ name: e.name, isOwn: e.competitorId === null, mentions: e.mentions })) : [],
    row: {
      id: site.id,
      name: site.name,
      domain: site.domain,
      activePromptsCount: Number(promptCnt?.n ?? 0),
      totalResponses: n,
      mentionRatePct: n ? pct(mentioned, n) : null,
      citationRatePct: n ? pct(cited, n) : null,
      sovPct: n ? visibility.totals.shareOfVoice : null,
      aiVisibleSearches: value.hasVolume ? value.aiVisibleSearches : null,
    },
  };
}

/** Own brands per website, competitors merged by name across websites. */
function sovRollup(metrics: SiteMetrics[]): GroupDashboardData["competitorSovRollup"] {
  const own = metrics.flatMap((m) => m.entities.filter((e) => e.isOwn).map((e) => ({ key: `own:${m.row.id}`, name: `${m.row.name} (${m.row.domain})`, isOwn: true, mentions: e.mentions })));
  const rivals = metrics.flatMap((m) => m.entities.filter((e) => !e.isOwn).map((e) => ({ key: `rival:${e.name.toLowerCase()}`, name: e.name, isOwn: false, mentions: e.mentions })));
  const merged = [...own, ...rivals].reduce((acc, e) => {
    const prev = acc.get(e.key);
    return new Map(acc).set(e.key, prev ? { ...prev, mentions: prev.mentions + e.mentions } : e);
  }, new Map<string, { key: string; name: string; isOwn: boolean; mentions: number }>());
  const all = [...merged.values()];
  const total = all.reduce((s, e) => s + e.mentions, 0);
  return all.filter((e) => e.mentions > 0).map((e) => ({ name: e.name, isOwn: e.isOwn, mentions: e.mentions, sovPct: pct(e.mentions, total) })).sort((a, b) => b.sovPct - a.sovPct).slice(0, 10);
}

async function groupBilling(db: Db, organizationId: string, groupId: string, siteIds: string[], siteNames: Map<string, string>): Promise<GroupDashboardData["billing"]> {
  const [[orgBal], [groupBal]] = await Promise.all([
    db.select({ balance: creditBalances.balance }).from(creditBalances).where(and(eq(creditBalances.organizationId, organizationId), isNull(creditBalances.websiteId), isNull(creditBalances.groupId))),
    db.select({ balance: creditBalances.balance }).from(creditBalances).where(and(eq(creditBalances.organizationId, organizationId), eq(creditBalances.groupId, groupId), isNull(creditBalances.websiteId))),
  ]);
  const scope = siteIds.length ? or(eq(creditLedger.groupId, groupId), inArray(creditLedger.websiteId, siteIds)) : eq(creditLedger.groupId, groupId);
  const rows = await db.select().from(creditLedger).where(and(eq(creditLedger.organizationId, organizationId), scope)).orderBy(desc(creditLedger.createdAt), desc(creditLedger.id)).limit(25);
  return {
    orgUnallocatedBalance: Number(orgBal?.balance ?? 0),
    groupSharedBalance: Number(groupBal?.balance ?? 0),
    totalGroupConsumedCredits: rows.filter((l) => l.amount < 0 && l.kind === "consume").reduce((s, l) => s + Math.abs(l.amount), 0),
    ledger: rows.map((l) => ({ id: l.id, kind: l.kind, amount: l.amount, reason: l.reason, websiteId: l.websiteId, websiteName: l.websiteId ? (siteNames.get(l.websiteId) ?? null) : null, groupId: l.groupId, createdAt: l.createdAt })),
  };
}

export async function getGroupDashboardData(
  db: Db,
  opts: { actorId: string; organizationId: string; groupId: string; domainFilter?: string; now?: Date },
): Promise<GroupDashboardData> {
  await requireMember(db, opts.actorId, opts.organizationId);
  const [group] = await db.select().from(groups).where(and(eq(groups.id, opts.groupId), eq(groups.organizationId, opts.organizationId), isNull(groups.deletedAt)));
  if (!group) throw new NotFoundError("Group not found");
  const [orgGroups, allSites, visible] = await Promise.all([
    db.select().from(groups).where(and(eq(groups.organizationId, opts.organizationId), isNull(groups.deletedAt))).orderBy(asc(groups.name)),
    db.select().from(websites).where(and(eq(websites.organizationId, opts.organizationId), isNull(websites.deletedAt))).orderBy(asc(websites.name)),
    listWebsitesForUser(db, opts.actorId),
  ]);
  // members only see the websites they can access (owners/admins see all)
  const visibleIds = new Set(visible.map((w) => w.id));
  const orgSites = allSites.filter((w) => visibleIds.has(w.id));
  const memberSites = orgSites.filter((w) => w.groupId === group.id);
  const needle = opts.domainFilter?.toLowerCase();
  const shown = needle ? memberSites.filter((w) => w.domain.toLowerCase().includes(needle) || w.name.toLowerCase().includes(needle)) : memberSites;
  const to = opts.now ?? new Date();
  const from = new Date(to.getTime() - PERIOD_DAYS * DAY);
  const metrics = await Promise.all(shown.map((site) => siteMetrics(db, site, from, to)));
  const totalResponses = metrics.reduce((s, m) => s + m.row.totalResponses, 0);
  const rollup = sovRollup(metrics);
  const ownMentions = rollup.filter((e) => e.isOwn).reduce((s, e) => s + e.mentions, 0);
  const allMentions = rollup.reduce((s, e) => s + e.mentions, 0);
  const values = metrics.map((m) => m.row.aiVisibleSearches).filter((v): v is number => v !== null);
  const views = await db.select().from(savedViews).where(eq(savedViews.groupId, group.id)).orderBy(desc(savedViews.createdAt));
  return {
    group: { id: group.id, organizationId: group.organizationId, name: group.name, createdAt: group.createdAt },
    allGroups: orgGroups.map((g) => ({ id: g.id, name: g.name, websiteCount: orgSites.filter((w) => w.groupId === g.id).length })),
    memberWebsites: metrics.map((m) => m.row),
    availableWebsites: orgSites.map((s) => ({ id: s.id, name: s.name, domain: s.domain, groupId: s.groupId })),
    periodDays: PERIOD_DAYS,
    kpis: {
      websiteCount: metrics.length,
      groupMentionRatePct: totalResponses ? pct(metrics.reduce((s, m) => s + m.mentioned, 0), totalResponses) : null,
      groupCitationRatePct: totalResponses ? pct(metrics.reduce((s, m) => s + m.cited, 0), totalResponses) : null,
      groupSovPct: allMentions ? pct(ownMentions, allMentions) : null,
      totalAiVisibleSearches: values.length ? values.reduce((s, v) => s + v, 0) : null,
      totalActivePrompts: metrics.reduce((s, m) => s + m.row.activePromptsCount, 0),
      totalResponses,
    },
    competitorSovRollup: rollup,
    savedViews: views.map((v) => ({ id: v.id, name: v.name, filters: (v.filters ?? {}) as Record<string, unknown>, createdAt: v.createdAt })),
    billing: await groupBilling(db, opts.organizationId, group.id, memberSites.map((s) => s.id), new Map(orgSites.map((s) => [s.id, s.name]))),
  };
}

const allocateCreditsSchema = z.object({
  actorId: z.string().uuid(),
  organizationId: z.string().uuid(),
  groupId: z.string().uuid(),
  amount: z.number().int().min(1, "Credit amount must be at least 1").max(1_000_000),
  direction: z.enum(["to_group", "to_org"]),
  reason: z.string().trim().max(240).optional(),
});

/**
 * Atomically transfers credits between the Organization unallocated pool and
 * a Group's shared credit pool (`credit_balances.group_id`), recording paired
 * entries in `credit_ledger`.
 */
export async function allocateGroupCredits(
  db: Db,
  rawInput: z.input<typeof allocateCreditsSchema>,
): Promise<{ orgBalance: number; groupBalance: number }> {
  const parsed = allocateCreditsSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid credit allocation input");
  }
  const input = parsed.data;

  await requirePermission(db, input.actorId, input.organizationId, "billing:write");

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"group_credits:" + input.organizationId}))`,
    );

    const [group] = await tx
      .select()
      .from(groups)
      .where(
        and(
          eq(groups.id, input.groupId),
          eq(groups.organizationId, input.organizationId),
          isNull(groups.deletedAt),
        ),
      );
    if (!group) throw new NotFoundError("Group not found");

    // Ensure group credit balance row exists
    const [existingGroupBal] = await tx
      .select()
      .from(creditBalances)
      .where(
        and(
          eq(creditBalances.organizationId, input.organizationId),
          eq(creditBalances.groupId, group.id),
          isNull(creditBalances.websiteId),
        ),
      );

    let groupBalanceRowId = existingGroupBal?.id;
    if (!groupBalanceRowId) {
      const [insertedGroupBal] = await tx
        .insert(creditBalances)
        .values({
          organizationId: input.organizationId,
          groupId: group.id,
          websiteId: null,
          balance: 0,
        })
        .returning({ id: creditBalances.id });
      groupBalanceRowId = insertedGroupBal!.id;
    }

    if (input.direction === "to_group") {
      const deducted = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} - ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.organizationId, input.organizationId),
            isNull(creditBalances.websiteId),
            isNull(creditBalances.groupId),
            gte(creditBalances.balance, input.amount),
          ),
        )
        .returning({ balance: creditBalances.balance });

      if (deducted.length === 0) {
        throw new DomainError("Insufficient organization credits to allocate to this group");
      }

      const credited = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(creditBalances.id, groupBalanceRowId))
        .returning({ balance: creditBalances.balance });

      const note = input.reason || `Shared credit allocation to group "${group.name}"`;
      await tx.insert(creditLedger).values([
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: null,
          kind: "adjustment",
          amount: -input.amount,
          reason: `Allocated to group: ${group.name}`,
        },
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: group.id,
          kind: "grant",
          amount: input.amount,
          reason: note,
        },
      ]);

      await logActivity(tx, {
        organizationId: input.organizationId,
        userId: input.actorId,
        entityType: "group_credits",
        entityId: group.id,
        change: "allocated_to_group",
        after: { amount: input.amount, groupBalance: credited[0]!.balance },
      });

      return {
        orgBalance: deducted[0]!.balance,
        groupBalance: credited[0]!.balance,
      };
    } else {
      const deducted = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} - ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.id, groupBalanceRowId),
            gte(creditBalances.balance, input.amount),
          ),
        )
        .returning({ balance: creditBalances.balance });

      if (deducted.length === 0) {
        throw new DomainError("Insufficient group shared credits to return to organization pool");
      }

      const credited = await tx
        .update(creditBalances)
        .set({
          balance: sql`${creditBalances.balance} + ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditBalances.organizationId, input.organizationId),
            isNull(creditBalances.websiteId),
            isNull(creditBalances.groupId),
          ),
        )
        .returning({ balance: creditBalances.balance });

      const note = input.reason || `Returned shared credits from group "${group.name}" to org pool`;
      await tx.insert(creditLedger).values([
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: group.id,
          kind: "adjustment",
          amount: -input.amount,
          reason: note,
        },
        {
          organizationId: input.organizationId,
          websiteId: null,
          groupId: null,
          kind: "grant",
          amount: input.amount,
          reason: `Returned from group: ${group.name}`,
        },
      ]);

      await logActivity(tx, {
        organizationId: input.organizationId,
        userId: input.actorId,
        entityType: "group_credits",
        entityId: group.id,
        change: "returned_to_org",
        after: { amount: input.amount, groupBalance: deducted[0]!.balance },
      });

      return {
        orgBalance: credited[0]?.balance ?? 0,
        groupBalance: deducted[0]!.balance,
      };
    }
  });
}

export async function createGroupSavedView(
  db: Db,
  rawInput: {
    actorId: string;
    organizationId: string;
    groupId: string;
    name: string;
    filters: Record<string, unknown>;
  },
) {
  await requirePermission(db, rawInput.actorId, rawInput.organizationId, "prompts:write");

  const name = rawInput.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw new DomainError("Saved view name must be between 2 and 80 characters");
  }

  const [group] = await db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.id, rawInput.groupId),
        eq(groups.organizationId, rawInput.organizationId),
        isNull(groups.deletedAt),
      ),
    );
  if (!group) throw new NotFoundError("Group not found");

  const [view] = await db
    .insert(savedViews)
    .values({
      groupId: group.id,
      websiteId: null,
      name,
      filters: rawInput.filters,
    })
    .returning();

  await logActivity(db, {
    organizationId: rawInput.organizationId,
    userId: rawInput.actorId,
    entityType: "group_saved_view",
    entityId: view!.id,
    change: "created",
    after: { groupId: group.id, name, filters: rawInput.filters },
  });

  return view!;
}

export async function deleteGroupSavedView(
  db: Db,
  rawInput: {
    actorId: string;
    organizationId: string;
    groupId: string;
    viewId: string;
  },
): Promise<void> {
  await requirePermission(db, rawInput.actorId, rawInput.organizationId, "prompts:write");

  const [group] = await db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.id, rawInput.groupId),
        eq(groups.organizationId, rawInput.organizationId),
        isNull(groups.deletedAt),
      ),
    );
  if (!group) throw new NotFoundError("Group not found");

  const deleted = await db
    .delete(savedViews)
    .where(and(eq(savedViews.id, rawInput.viewId), eq(savedViews.groupId, group.id)))
    .returning({ id: savedViews.id });

  if (deleted.length === 0) {
    throw new NotFoundError("Saved view not found");
  }
}
