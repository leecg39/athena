/* Identity & tenancy */
import { pgTable, integer, uuid, text, timestamp, boolean, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { deletedAt, inviteStatusEnum, memberRoleEnum, orgRoleEnum, planEnum, ts } from "./enums";
import { prompts } from "./tracking";

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text(),
  image: text(),
  emailVerified: timestamp({ withTimezone: true, mode: "date" }),
  jobTitle: text(),
  /** bumped to invalidate every outstanding session ("sign out everywhere") */
  sessionVersion: integer().notNull().default(0),
  createdAt: ts().notNull(),
});

export const organizations = pgTable("organizations", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  plan: planEnum().notNull().default("free"),
  createdAt: ts().notNull(),
  deletedAt: deletedAt(),
});

/** Custom roles (per-org permission sets). */
export const customRoles = pgTable(
  "custom_roles",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    name: text().notNull(),
    /** jsonb array of permission strings, e.g. ["prompts:read","billing:write"] */
    permissions: jsonb().$type<string[]>().notNull().default([]),
    createdAt: ts().notNull(),
  },
  (t) => [uniqueIndex("custom_roles_org_name_idx").on(t.organizationId, t.name)],
);

export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: orgRoleEnum().notNull().default("member"),
    customRoleId: uuid().references(() => customRoles.id),
    createdAt: ts().notNull(),
  },
  (t) => [uniqueIndex("org_members_org_user_idx").on(t.organizationId, t.userId)],
);

/** Brand groups (agencies / multi-brand portfolios). */
export const groups = pgTable("groups", {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id),
  name: text().notNull(),
  createdAt: ts().notNull(),
  deletedAt: deletedAt(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid()
      .notNull()
      .references(() => groups.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: memberRoleEnum().notNull().default("member"),
    createdAt: ts().notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

/** A tracked brand/website — the workspace unit. */
export const websites = pgTable(
  "websites",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    groupId: uuid().references(() => groups.id),
    domain: text().notNull(),
    name: text().notNull(),
    brandVoice: text(),
    brandTraits: jsonb().$type<string[]>().default([]),
    /** canonical brand profile for tracking + generation */
    profile: jsonb()
      .$type<{
        description?: string;
        products?: string[];
        audiences?: string[];
        differentiators?: string[];
      }>()
      .default({}),
    llmsTxtEnabled: boolean().notNull().default(false),
    timezone: text().notNull().default("UTC"),
    country: text().notNull().default("US"),
    createdAt: ts().notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [index("websites_org_idx").on(t.organizationId)],
);

export const websiteMembers = pgTable(
  "website_members",
  {
    websiteId: uuid()
      .notNull()
      .references(() => websites.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: memberRoleEnum().notNull().default("member"),
    customRoleId: uuid().references(() => customRoles.id),
    createdAt: ts().notNull(),
  },
  (t) => [primaryKey({ columns: [t.websiteId, t.userId] })],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    websiteId: uuid().references(() => websites.id),
    groupId: uuid().references(() => groups.id),
    email: text().notNull(),
    role: orgRoleEnum().notNull().default("member"),
    customRoleId: uuid().references(() => customRoles.id),
    status: inviteStatusEnum().notNull().default("pending"),
    /** sha256 of the invite token (the token itself is only shown/sent once) */
    tokenHash: text().notNull().unique(),
    inviterId: uuid().references(() => users.id),
    createdAt: ts().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index("invites_org_idx").on(t.organizationId, t.status)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    websiteId: uuid().references(() => websites.id),
    userId: uuid().references(() => users.id),
    entityType: text().notNull(), // prompt | topic | tag | website | member ...
    entityId: uuid(),
    change: text().notNull(), // created | updated | deleted | restored | paused | unpaused
    before: jsonb(),
    after: jsonb(),
    createdAt: ts().notNull(),
  },
  (t) => [index("activity_org_time_idx").on(t.organizationId, t.createdAt)],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id),
  name: text().notNull(),
  hashedKey: text().notNull().unique(),
  prefix: text().notNull(),
  lastUsedAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
  createdAt: ts().notNull(),
});
