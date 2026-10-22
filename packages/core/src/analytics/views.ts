/** Olympus dashboard state (URL ⇄ saved views) and saved-view CRUD. */
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { type Db, savedViews } from "@athena/db";
import { requireWebsitePermission } from "../tenancy";
import { logActivity } from "../org/activity";
import { NotFoundError } from "../org/errors";
import type { VisibilityFilters } from "./visibility";

export const CARD_IDS = ["mention", "citation", "sov", "position", "value"] as const;
export type CardId = (typeof CARD_IDS)[number];
export const RANGES = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 } as const;

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const DashboardStateSchema = z.object({
  range: z.enum(["7d", "14d", "30d", "90d", "custom"]),
  from: day.optional(),
  to: day.optional(),
  models: z.array(z.string().regex(/^[a-z_]{2,20}$/)).max(20),
  topicId: uuid.optional(),
  personaId: uuid.optional(),
  locationId: uuid.optional(),
  tagId: uuid.optional(),
  type: z.enum(["branded", "non_branded"]).optional(),
  cards: z.array(z.enum(CARD_IDS)).max(CARD_IDS.length),
  chart: z.enum(["detailed", "simple"]),
});
export type DashboardState = z.infer<typeof DashboardStateSchema>;

const list = (v: unknown) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : Array.isArray(v) ? v.map(String) : []);
const pick = <T>(v: unknown, ok: (x: unknown) => x is T): T | undefined => (ok(v) ? v : undefined);
const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.safeParse(v).success;

/** Lenient parse: invalid values are dropped, never thrown. */
export function parseDashboardState(params: Record<string, unknown>): DashboardState {
  const range = ["7d", "14d", "30d", "90d", "custom"].includes(String(params.range)) ? (String(params.range) as DashboardState["range"]) : "30d";
  const from = day.safeParse(params.from).success ? String(params.from) : undefined;
  const to = day.safeParse(params.to).success ? String(params.to) : undefined;
  const validCustom = range === "custom" && from && to && from <= to;
  return {
    range: range === "custom" && !validCustom ? "30d" : range,
    from: validCustom ? from : undefined,
    to: validCustom ? to : undefined,
    models: list(params.models).filter((m) => /^[a-z_]{2,20}$/.test(m)).slice(0, 20),
    topicId: pick(params.topicId, isUuid),
    personaId: pick(params.personaId, isUuid),
    locationId: pick(params.locationId, isUuid),
    tagId: pick(params.tagId, isUuid),
    type: params.type === "branded" || params.type === "non_branded" ? params.type : undefined,
    cards: [...new Set(list(params.cards).filter((c): c is CardId => (CARD_IDS as readonly string[]).includes(c)))],
    chart: params.chart === "simple" ? "simple" : "detailed",
  };
}

export function stateToSearchParams(s: DashboardState): URLSearchParams {
  const p = new URLSearchParams();
  p.set("range", s.range);
  if (s.range === "custom" && s.from && s.to) {
    p.set("from", s.from);
    p.set("to", s.to);
  }
  if (s.models.length) p.set("models", s.models.join(","));
  for (const k of ["topicId", "personaId", "locationId", "tagId", "type"] as const) if (s[k]) p.set(k, s[k]!);
  if (s.cards.length) p.set("cards", s.cards.join(","));
  if (s.chart !== "detailed") p.set("chart", s.chart);
  return p;
}

/** Current [from, to) window and the equally long previous window. */
export function stateToFilters(s: DashboardState, now = new Date()): { current: VisibilityFilters; previous: VisibilityFilters } {
  let from: Date;
  let to: Date;
  if (s.range === "custom" && s.from && s.to) {
    from = new Date(`${s.from}T00:00:00Z`);
    to = new Date(new Date(`${s.to}T00:00:00Z`).getTime() + 86_400_000);
  } else {
    to = now;
    from = new Date(now.getTime() - RANGES[s.range as keyof typeof RANGES] * 86_400_000);
  }
  const span = to.getTime() - from.getTime();
  const common = {
    models: s.models.length ? s.models : undefined,
    topicIds: s.topicId ? [s.topicId] : undefined,
    personaIds: s.personaId ? [s.personaId] : undefined,
    locationIds: s.locationId ? [s.locationId] : undefined,
    tagIds: s.tagId ? [s.tagId] : undefined,
    promptType: s.type,
  };
  return { current: { ...common, from, to }, previous: { ...common, from: new Date(from.getTime() - span), to: from } };
}

/* ---------------- saved views ---------------- */

export interface SavedView {
  id: string;
  name: string;
  state: DashboardState;
  createdAt: Date;
}

export async function listViews(db: Db, input: { actorId: string; websiteId: string }): Promise<SavedView[]> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  const rows = await db.select().from(savedViews).where(eq(savedViews.websiteId, site.id)).orderBy(asc(savedViews.name));
  return rows.map((r) => ({ id: r.id, name: r.name, state: parseDashboardState(r.filters as Record<string, unknown>), createdAt: r.createdAt }));
}

export async function createView(db: Db, input: { actorId: string; websiteId: string; name: string; state: DashboardState }): Promise<SavedView> {
  const name = z.string().trim().min(1).max(60).parse(input.name);
  const state = DashboardStateSchema.parse(input.state);
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  return db.transaction(async (tx) => {
    const flat = Object.fromEntries([...stateToSearchParams(state)].map(([k, v]) => [k, v]));
    const [row] = await tx.insert(savedViews).values({ websiteId: site.id, name, filters: flat }).returning();
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "saved_view", entityId: row.id, change: "created", after: { name } });
    return { id: row.id, name: row.name, state, createdAt: row.createdAt };
  });
}

export async function deleteView(db: Db, input: { actorId: string; websiteId: string; viewId: string }): Promise<void> {
  const site = await requireWebsitePermission(db, input.actorId, input.websiteId, "prompts:read");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(savedViews)
      .where(and(eq(savedViews.id, input.viewId), eq(savedViews.websiteId, site.id)))
      .returning();
    if (!row) throw new NotFoundError("Saved view not found");
    await logActivity(tx, { organizationId: site.organizationId, userId: input.actorId, websiteId: site.id, entityType: "saved_view", entityId: row.id, change: "deleted", before: { name: row.name } });
  });
}
