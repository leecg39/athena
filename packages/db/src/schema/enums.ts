/* Enums */
import { pgEnum, timestamp } from "drizzle-orm/pg-core";

export const orgRoleEnum = pgEnum("org_role", [
  "owner",
  "admin",
  "billing",
  "member",
  "custom",
]);
export const memberRoleEnum = pgEnum("member_role", [
  "owner",
  "admin",
  "member",
  "custom",
]);
export const inviteStatusEnum = pgEnum("invite_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);
export const promptStatusEnum = pgEnum("prompt_status", [
  "active",
  "paused",
  "deleted",
]);
export const promptTypeEnum = pgEnum("prompt_type", ["branded", "non_branded"]);
export const runStateEnum = pgEnum("run_state", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const sentimentEnum = pgEnum("sentiment", [
  "positive",
  "neutral",
  "negative",
  "mixed",
  "unknown",
]);
export const sourceTypeEnum = pgEnum("source_type", [
  "c", // community
  "t", // third-party
  "o", // owned
  "p", // partner/press
]);
export const factStatusEnum = pgEnum("fact_status", [
  "pending_review",
  "confirmed",
  "rejected",
]);
export const contentStatusEnum = pgEnum("content_status", [
  "idea",
  "brief",
  "draft",
  "review",
  "approved",
  "published",
]);
export const insightStatusEnum = pgEnum("insight_status", [
  "active",
  "resolved",
  "discarded",
]);
export const oracleFindingEnum = pgEnum("oracle_finding_type", [
  "confirmed_inaccuracy",
  "kb_inconsistency",
  "model_disagreement",
]);
export const oracleStatusEnum = pgEnum("oracle_status", [
  "open",
  "resolving",
  "resolved",
  "dismissed",
]);
export const outreachStatusEnum = pgEnum("outreach_status", [
  "new",
  "todo",
  "done",
]);
export const planEnum = pgEnum("plan_tier", ["free", "starter", "enterprise"]);
export const subStatusEnum = pgEnum("subscription_status", [
  "active",
  "trialing",
  "past_due",
  "canceled",
]);
export const scheduleKindEnum = pgEnum("schedule_kind", [
  "default",
  "custom",
  "archived",
]);
export const healthStatusEnum = pgEnum("health_status", [
  "pass",
  "warn",
  "fail",
  "pending",
]);

export const ts = () => timestamp({ withTimezone: true }).defaultNow();
export const deletedAt = () => timestamp({ withTimezone: true });
