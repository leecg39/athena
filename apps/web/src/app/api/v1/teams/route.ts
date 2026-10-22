import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  db,
  customRoles,
  groups,
  orgMembers,
  users,
  websites,
} from "@athena/db";
import { authenticate, isResponse } from "@/lib/api-key";

/**
 * GET /api/v1/teams
 * Returns organization members, portfolio groups, tracked websites, and custom RBAC roles
 * scoped strictly to the API key's organization.
 */
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (isResponse(ctx)) return ctx;

  try {
    const [memberRows, groupRows, websiteRows, roleRows] = await Promise.all([
      db
        .select({
          id: orgMembers.id,
          userId: users.id,
          email: users.email,
          name: users.name,
          jobTitle: users.jobTitle,
          role: orgMembers.role,
          customRoleId: orgMembers.customRoleId,
          joinedAt: orgMembers.createdAt,
        })
        .from(orgMembers)
        .innerJoin(users, eq(users.id, orgMembers.userId))
        .where(eq(orgMembers.organizationId, ctx.organizationId))
        .orderBy(asc(orgMembers.createdAt)),
      db
        .select({
          id: groups.id,
          name: groups.name,
          createdAt: groups.createdAt,
        })
        .from(groups)
        .where(and(eq(groups.organizationId, ctx.organizationId), isNull(groups.deletedAt)))
        .orderBy(asc(groups.name)),
      db
        .select({
          id: websites.id,
          name: websites.name,
          domain: websites.domain,
          groupId: websites.groupId,
          country: websites.country,
          timezone: websites.timezone,
          createdAt: websites.createdAt,
        })
        .from(websites)
        .where(and(eq(websites.organizationId, ctx.organizationId), isNull(websites.deletedAt)))
        .orderBy(asc(websites.name)),
      db
        .select({
          id: customRoles.id,
          name: customRoles.name,
          permissions: customRoles.permissions,
          createdAt: customRoles.createdAt,
        })
        .from(customRoles)
        .where(eq(customRoles.organizationId, ctx.organizationId))
        .orderBy(asc(customRoles.name)),
    ]);

    return NextResponse.json({
      data: {
        members: memberRows,
        groups: groupRows,
        websites: websiteRows,
        customRoles: roleRows,
      },
      meta: {
        organizationId: ctx.organizationId,
        membersCount: memberRows.length,
        groupsCount: groupRows.length,
        websitesCount: websiteRows.length,
      },
    });
  } catch {
    return NextResponse.json(
      { data: { members: [], groups: [], websites: [], customRoles: [] }, note: "database unavailable" },
      { status: 200 },
    );
  }
}
