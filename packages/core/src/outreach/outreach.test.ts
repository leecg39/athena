import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "@athena/db/testing";
import {
  users,
  orgMembers,
  websiteMembers,
  customRoles,
  prompts,
  responses,
  responseCitations,
  kbPillars,
  kbFacts,
  competitors,
} from "@athena/db";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { DomainError, ForbiddenError } from "../org/errors";
import {
  discoverOutreachOpportunities,
  listOutreachOpportunities,
  createOutreachOpportunity,
  findOutreachAuthor,
  generateOutreachEmailDraft,
  updateOutreachStatus,
  updateOutreachOpportunity,
  deleteOutreachOpportunity,
} from "./index";

describe("outreach opportunity discovery, author finder, email draft generator & kanban pipeline", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string };

  beforeAll(async () => {
    t = await createTestDb();
    const { user, organizationId } = await ensureUserWithOrg(t.db, {
      email: "outreach-owner@example.com",
      name: "Outreach Owner",
    });
    const site = await createWebsite(t.db, {
      organizationId,
      userId: user.id,
      domain: "canvasly.io",
      name: "Canvasly",
    });
    c = { actorId: user.id, websiteId: site.id };

    // Seed KB fact & competitor for outreach email pitch grounding
    const [pillar] = await t.db
      .insert(kbPillars)
      .values({
        websiteId: site.id,
        name: "Product & Pricing",
        document: "# Product\nCanvasly Pro starts at $29/mo.",
      })
      .returning();
    await t.db.insert(kbFacts).values({
      websiteId: site.id,
      pillarId: pillar.id,
      claim: "Canvasly Pro starts at $29 per month and includes 50 free seats for product teams",
      status: "confirmed",
      confidence: "0.99",
    });
    await t.db.insert(competitors).values({
      websiteId: site.id,
      domain: "figma.com",
      name: "Figma",
    });

    // Seed prompt + AI responses + third-party citations
    const [pRow] = await t.db
      .insert(prompts)
      .values({
        websiteId: site.id,
        text: "best ai design tools for product teams",
        type: "non_branded",
        volumeEstimate: 2400,
      })
      .returning();

    const [r1] = await t.db
      .insert(responses)
      .values({
        websiteId: site.id,
        promptId: pRow.id,
        model: "chatgpt",
        rawText: "1. Figma — popular choice.",
        mentioned: false,
        cited: false,
      })
      .returning();

    await t.db.insert(responseCitations).values([
      {
        responseId: r1.id,
        url: "https://forbes.com/advisor/business/software/best-design-software",
        domain: "forbes.com",
        rootDomain: "forbes.com",
        normalizedUrl: "https://forbes.com/advisor/business/software/best-design-software",
        rank: 1,
        isBrand: false,
      },
      {
        responseId: r1.id,
        url: "https://g2.com/categories/ai-design-tools",
        domain: "g2.com",
        rootDomain: "g2.com",
        normalizedUrl: "https://g2.com/categories/ai-design-tools",
        rank: 2,
        isBrand: false,
      },
    ]);

    // Read-only viewer
    const [viewer] = await t.db.insert(users).values({ email: "outreach-viewer@example.com", name: "Viewer" }).returning();
    const [role] = await t.db
      .insert(customRoles)
      .values({ organizationId, name: "Outreach Reader", permissions: ["websites:read", "content:read"] })
      .returning();
    await t.db.insert(orgMembers).values({ organizationId, userId: viewer.id, role: "custom", customRoleId: role.id });
    await t.db.insert(websiteMembers).values({ websiteId: site.id, userId: viewer.id, role: "member" });
    viewerId = viewer.id;

    // Outsider
    const o = await ensureUserWithOrg(t.db, { email: "outreach-outsider@example.com" });
    const oSite = await createWebsite(t.db, { organizationId: o.organizationId, userId: o.user.id, domain: "other.io", name: "Other" });
    outsider = { actorId: o.user.id, websiteId: oSite.id };
  });

  afterAll(async () => {
    await t.close();
  });

  it("discovers citation opportunities idempotently under concurrent runs and validates manual additions", async () => {
    const [d1, d2] = await Promise.all([
      discoverOutreachOpportunities(t.db, c),
      discoverOutreachOpportunities(t.db, c),
    ]);
    expect(d1.created + d2.created).toBeGreaterThanOrEqual(5);

    const list1 = await listOutreachOpportunities(t.db, c);
    expect(list1.rows.length).toBeGreaterThanOrEqual(5);
    expect(list1.rows.some((r) => r.domain === "forbes.com")).toBe(true);

    // Rejects own-brand domain as outreach opportunity
    await expect(
      createOutreachOpportunity(t.db, { ...c, url: "https://canvasly.io/blog/post" }),
    ).rejects.toBeInstanceOf(DomainError);

    // Rejects unsafe URL scheme and private/loopback IPs
    await expect(
      createOutreachOpportunity(t.db, { ...c, url: "javascript:alert(1)" }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      createOutreachOpportunity(t.db, { ...c, url: "http://127.0.0.1:8080/internal" }),
    ).rejects.toBeInstanceOf(DomainError);

    // Creates manual external opportunity
    const manual = await createOutreachOpportunity(t.db, {
      ...c,
      url: "https://smashingmagazine.com/2026/09/design-systems-tools",
      citationPct: 18.4,
      estimatedImpressions: 29500,
      citations: 14,
      notes: "High authority design engineering roundup",
    });
    expect(manual.domain).toBe("smashingmagazine.com");
    expect(manual.status).toBe("new");

    // Duplicate URL rejected
    await expect(
      createOutreachOpportunity(t.db, { ...c, url: "https://smashingmagazine.com/2026/09/design-systems-tools/" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("finds authors, generates KB-grounded pitch email drafts, and transitions Kanban status (new -> todo -> done)", async () => {
    const list = await listOutreachOpportunities(t.db, c);
    const target = list.rows.find((r) => r.domain === "forbes.com") ?? list.rows[0]!;
    expect(target.status).toBe("new");

    // Step 1: Author Finder
    const withAuthor = await findOutreachAuthor(t.db, {
      ...c,
      opportunityId: target.id,
    });
    expect(withAuthor.authorName).toBeTruthy();
    expect(withAuthor.authorEmail).toContain("@");

    // Step 2: Generate Email Draft grounded in KB facts & competitors (automatically moves new -> todo)
    const withDraft = await generateOutreachEmailDraft(t.db, {
      ...c,
      opportunityId: target.id,
      angle: "Offer interactive benchmark dataset for 2026 update",
    });
    expect(withDraft.emailDraft).toContain("Canvasly Pro starts at $29 per month");
    expect(withDraft.emailDraft).toContain("Figma");
    expect(withDraft.status).toBe("todo");

    // Step 3: Move Todo -> Done on Kanban board
    const doneRow = await updateOutreachStatus(t.db, {
      ...c,
      opportunityId: target.id,
      status: "done",
    });
    expect(doneRow.status).toBe("done");

    // Step 4: Edit notes & custom author email
    const edited = await updateOutreachOpportunity(t.db, {
      ...c,
      opportunityId: target.id,
      notes: "Sent pitch email on Oct 23; editor replied positivamente",
    });
    expect(edited.notes).toContain("Sent pitch email");

    // Re-running discovery preserves status ('done'), author, emailDraft, and notes!
    await discoverOutreachOpportunities(t.db, c);
    const afterRediscover = await listOutreachOpportunities(t.db, { ...c, status: "done" });
    const preserved = afterRediscover.rows.find((r) => r.id === target.id);
    expect(preserved).toBeTruthy();
    expect(preserved!.emailDraft).toContain("Canvasly Pro starts at $29 per month");

    // Delete temporary opportunity
    const temp = await createOutreachOpportunity(t.db, {
      ...c,
      url: "https://venturebeat.com/ai/design-tools-comparison",
    });
    await deleteOutreachOpportunity(t.db, { ...c, opportunityId: temp.id });
    const afterDel = await listOutreachOpportunities(t.db, c);
    expect(afterDel.rows.map((r) => r.id)).not.toContain(temp.id);
  });

  it("enforces tenant isolation and RBAC across Outreach", async () => {
    await expect(listOutreachOpportunities(t.db, { actorId: viewerId, websiteId: c.websiteId })).resolves.toBeTruthy();

    await expect(
      discoverOutreachOpportunities(t.db, { actorId: viewerId, websiteId: c.websiteId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createOutreachOpportunity(t.db, { actorId: viewerId, websiteId: c.websiteId, url: "https://wired.com/story/ai" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(listOutreachOpportunities(t.db, { actorId: outsider.actorId, websiteId: c.websiteId })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
