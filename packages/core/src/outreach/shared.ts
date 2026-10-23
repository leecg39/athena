/** Shared outreach types, URL validation and row mapping. */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { type Db, outreachOpportunities } from "@athena/db";
import { DomainError, NotFoundError } from "../org/errors";

export function normalizeDomain(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "");
}

export const OUTREACH_STATUSES = ["new", "todo", "done"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export interface OutreachOpportunityRow {
  id: string;
  websiteId: string;
  url: string;
  domain: string;
  status: OutreachStatus;
  citationPct: number;
  estimatedImpressions: number;
  citations: number;
  authorName: string | null;
  authorEmail: string | null;
  emailDraft: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface OutreachListResult {
  rows: OutreachOpportunityRow[];
  counts: {
    new: number;
    todo: number;
    done: number;
    total: number;
  };
  stats: {
    totalEstimatedImpressions: number;
    avgCitationPct: number;
    withAuthorCount: number;
    withDraftCount: number;
  };
  domains: string[];
}

export const DAY = 86_400_000;
export const MAX_OUTREACH_ITEMS = 400;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseExternalOutreachUrl(raw: string, brandDomain: string): { url: string; domain: string } {
  const trimmed = raw.trim();
  if (!trimmed) throw new DomainError("Outreach URL is required");
  const withProto = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.includes("://") || /^[a-z]+:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    throw new DomainError("Invalid outreach URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new DomainError("Outreach URL must use http or https");
  }
  const host = normalizeDomain(u.hostname);
  const brandHost = normalizeDomain(brandDomain);
  if (!host || !host.includes(".")) {
    throw new DomainError("Outreach URL must have a valid domain");
  }
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new DomainError("Outreach URL must be a public third-party domain");
  }
  if (host === brandHost || host.endsWith(`.${brandHost}`)) {
    throw new DomainError(`Outreach opportunities must be external third-party URLs (not ${brandHost})`);
  }
  u.hash = "";
  const cleanPath = u.pathname === "/" ? "/" : u.pathname.replace(/\/+$/, "");
  return {
    url: `${u.protocol}//${host}${cleanPath}${u.search}`,
    domain: host,
  };
}

export function toOpportunityRow(r: typeof outreachOpportunities.$inferSelect): OutreachOpportunityRow {
  return {
    id: r.id,
    websiteId: r.websiteId,
    url: r.url,
    domain: r.domain,
    status: r.status,
    citationPct: Number(r.citationPct ?? 0),
    estimatedImpressions: r.estimatedImpressions ?? 0,
    citations: r.citations ?? 0,
    authorName: r.authorName ?? null,
    authorEmail: r.authorEmail ?? null,
    emailDraft: r.emailDraft ?? null,
    notes: r.notes ?? null,
    createdAt: r.createdAt,
  };
}

export type OpportunityRecord = typeof outreachOpportunities.$inferSelect;

/** The opportunity row of this website, locked for update inside `tx`. */
export async function lockedOpportunity(tx: Db, websiteId: string, opportunityId: string): Promise<OpportunityRecord> {
  if (!z.string().uuid().safeParse(opportunityId).success) throw new DomainError("Invalid outreach opportunity ID");
  const [row] = await tx
    .select()
    .from(outreachOpportunities)
    .where(and(eq(outreachOpportunities.id, opportunityId), eq(outreachOpportunities.websiteId, websiteId)))
    .for("update");
  if (!row) throw new NotFoundError("Outreach opportunity not found");
  return row;
}
