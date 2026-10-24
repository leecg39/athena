/** Public share links for scheduled reports (no recipients, Slack or org data in the payload). */
import { and, eq, isNull } from "drizzle-orm";
import { type Db, scheduledReports, websites } from "@athena/db";
import { NotFoundError } from "../org/errors";
import { toScheduledReportItem, type PublicReportData } from "./catalog";
import { buildReportData } from "./data";

const SHARE_ID = /^(rpt|cpr)_[0-9a-f]{16,64}$/;

export async function getPublicReportByShareId(db: Db, shareId: string): Promise<PublicReportData> {
  const id = shareId.trim();
  if (!SHARE_ID.test(id)) throw new NotFoundError("Report share link not found");
  const [row] = await db
    .select({ report: scheduledReports, site: websites })
    .from(scheduledReports)
    .innerJoin(websites, and(eq(websites.id, scheduledReports.websiteId), isNull(websites.deletedAt)))
    .where(eq(scheduledReports.shareId, id));
  if (!row) throw new NotFoundError("Report share link not found");
  return buildReportData(db, row.site, toScheduledReportItem(row.report));
}
