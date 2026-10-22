import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  users,
  orgMembers,
  websiteMembers,
  customRoles,
  kbPillars,
  kbFacts,
  siteHealthPages,
  prompts,
  competitors,
  contentItems,
  contentVersions,
  publishTargets,
  shoppingProducts,
} from "@athena/db";
import { createTestDb, type TestDb } from "@athena/db/testing";
import { ensureUserWithOrg, createWebsite } from "../tenancy";
import { DomainError, ForbiddenError, NotFoundError } from "../org/errors";
import {
  listContentHub,
  seedInitialContentItems,
  createContentItem,
  importContentFromUrl,
  updateContentItem,
  deleteContentItem,
  generateContentBrief,
  approveContentBrief,
  generateContentDraft,
  reviseWithAthena,
  saveContentVersion,
  CMS_PROVIDERS,
  listPublishTargets,
  upsertPublishTarget,
  deletePublishTarget,
  publishContentItem,
  syncShopifyCatalog,
  listCatalogProducts,
  generateCatalogProductDraft,
  applyCatalogOptimizationToShopify,
} from "./index";

describe("content hub, AI agent pipeline, CMS publishing & Shopify catalog optimization", () => {
  let t: TestDb;
  let c: { actorId: string; websiteId: string };
  let promptId: string;
  let viewerId: string;
  let outsider: { actorId: string; websiteId: string };

  beforeAll(async () => {
    t = await createTestDb();
    const { user, organizationId } = await ensureUserWithOrg(t.db, {
      email: "content-owner@example.com",
      name: "Content Owner",
    });
    const site = await createWebsite(t.db, {
      organizationId,
      userId: user.id,
      domain: "canvasly.io",
      name: "Canvasly",
    });
    c = { actorId: user.id, websiteId: site.id };

    // Seed KB fact, internal link, prompt, and competitor for grounding
    const [pillar] = await t.db
      .insert(kbPillars)
      .values({
        websiteId: site.id,
        name: "Pricing & Plans",
        document: "# Pricing\nCanvasly Pro starts at $29/month.",
      })
      .returning();
    await t.db.insert(kbFacts).values({
      websiteId: site.id,
      pillarId: pillar.id,
      claim: "Canvasly Pro pricing starts at $29 per month and includes 50 free seats",
      sourceUrl: "https://canvasly.io/pricing",
      status: "confirmed",
      confidence: "0.99",
    });
    await t.db.insert(siteHealthPages).values({
      websiteId: site.id,
      url: "https://canvasly.io/pricing",
      title: "Canvasly Official Pricing",
      keywords: [{ keyword: "canvasly pricing", position: 1 }],
    });
    await t.db.insert(competitors).values({
      websiteId: site.id,
      domain: "figma.com",
      name: "Figma",
    });
    const [pRow] = await t.db
      .insert(prompts)
      .values({
        websiteId: site.id,
        text: "best ai design tools for product teams",
        type: "non_branded",
      })
      .returning();
    promptId = pRow.id;

    // Read-only viewer (websites:read + content:read, no content:write)
    const [viewer] = await t.db.insert(users).values({ email: "content-viewer@example.com", name: "Content Viewer" }).returning();
    const [role] = await t.db
      .insert(customRoles)
      .values({ organizationId, name: "Content Reader", permissions: ["websites:read", "content:read"] })
      .returning();
    await t.db.insert(orgMembers).values({ organizationId, userId: viewer.id, role: "custom", customRoleId: role.id });
    await t.db.insert(websiteMembers).values({ websiteId: site.id, userId: viewer.id, role: "member" });
    viewerId = viewer.id;

    // Outsider in another org
    const o = await ensureUserWithOrg(t.db, { email: "content-outsider@example.com" });
    const oSite = await createWebsite(t.db, { organizationId: o.organizationId, userId: o.user.id, domain: "other.io", name: "Other" });
    outsider = { actorId: o.user.id, websiteId: oSite.id };
  });

  afterAll(async () => {
    await t.close();
  });

  it("seeds initial content hub rows idempotently and manages spreadsheet grid CRUD + URL import", async () => {
    const [s1, s2] = await Promise.all([
      seedInitialContentItems(t.db, c),
      seedInitialContentItems(t.db, c),
    ]);
    expect(s1.created + s2.created).toBe(4);

    const snap1 = await listContentHub(t.db, c);
    expect(snap1.items).toHaveLength(4);
    expect(snap1.counts.total).toBe(4);

    // Create new content item with custom spreadsheet columns
    const created = await createContentItem(t.db, {
      ...c,
      title: "Canvasly Design System Tokens Playbook",
      targetUrl: "/guides/design-system-tokens",
      promptId,
      status: "idea",
      columns: {
        contentType: "Playbook",
        targetKeyword: "design system tokens",
        persona: "Staff Designer",
        priorityTier: "P0",
      },
    });
    expect(created.targetUrl).toBe("https://canvasly.io/guides/design-system-tokens");
    expect(created.columns?.priorityTier).toBe("P0");

    // Duplicate title rejected
    await expect(
      createContentItem(t.db, { ...c, title: "  canvasly design system tokens playbook " }),
    ).rejects.toBeInstanceOf(DomainError);

    // Unsafe URL rejected
    await expect(
      createContentItem(t.db, { ...c, title: "Bad URL Item", targetUrl: "javascript:alert(1)" }),
    ).rejects.toBeInstanceOf(DomainError);

    // Import existing URL
    const imported = await importContentFromUrl(t.db, {
      ...c,
      url: "https://canvasly.io/enterprise-security",
      title: "Canvasly Enterprise Security Architecture",
      targetKeyword: "enterprise design security",
    });
    expect(imported.status).toBe("draft");

    // Update custom columns & status
    const updated = await updateContentItem(t.db, {
      ...c,
      contentId: created.id,
      columns: { priorityTier: "P1", owner: "Design Ops" },
    });
    expect(updated.columns?.priorityTier).toBe("P1");
    expect(updated.columns?.owner).toBe("Design Ops");

    // Delete temporary item
    const temp = await createContentItem(t.db, { ...c, title: "Temp Content Item To Delete" });
    await deleteContentItem(t.db, { ...c, contentId: temp.id });
    const [delRow] = await t.db.select().from(contentItems).where(eq(contentItems.id, temp.id));
    expect(delRow.deletedAt).not.toBeNull();
  });

  it("runs the AI agent pipeline (Brief -> Approve -> Draft -> Version) and Revise with Athena grounded in KB facts", async () => {
    const item = await createContentItem(t.db, {
      ...c,
      title: "How Product Teams Automate Handoff with Canvasly",
      promptId,
      status: "idea",
    });

    // Step 1: Generate Brief grounded in KB facts & internal links
    const brief = await generateContentBrief(t.db, {
      ...c,
      contentId: item.id,
      focusNotes: "Emphasize $29/mo Pro tier and 50 free seats",
    });
    expect(brief.body).toContain("Canvasly Pro pricing starts at $29 per month");
    expect(brief.body).toContain("https://canvasly.io/pricing");
    expect(brief.approvedAt).toBeNull();

    // Step 2: Approve Brief
    const approvedBrief = await approveContentBrief(t.db, {
      ...c,
      contentId: item.id,
      briefId: brief.id,
    });
    expect(approvedBrief.approvedAt).not.toBeNull();

    // Step 3: Generate Draft (creates v1)
    const { draft, version: v1 } = await generateContentDraft(t.db, {
      ...c,
      contentId: item.id,
      briefId: brief.id,
      instructions: "Include a comparison table against Figma",
    });
    expect(draft.body).toContain("Canvasly Pro pricing starts at $29 per month");
    expect(draft.body).toContain("Figma");
    expect(v1.version).toBe(1);

    // Step 4: Revise with Athena (creates v2 and sets status to review)
    const rev = await reviseWithAthena(t.db, {
      ...c,
      contentId: item.id,
      instruction: "Add executive takeaway citing official pricing URL",
    });
    expect(rev.version.version).toBe(2);
    expect(rev.version.body).toContain("Athena AI Revision (v2)");
    expect(rev.status).toBe("review");

    // Step 5: Manual version save (creates v3 and sets status to approved)
    const v3 = await saveContentVersion(t.db, {
      ...c,
      contentId: item.id,
      body: `${rev.version.body}\n\nApproved by Editorial Lead.`,
      status: "approved",
    });
    expect(v3.version).toBe(3);

    const versions = await t.db.select().from(contentVersions).where(eq(contentVersions.contentId, item.id));
    expect(versions).toHaveLength(3);
  });

  it("connects CMS publish targets (with SSRF guard & secret masking) and publishes across all 8 CMS providers", async () => {
    // Rejects loopback/private SSRF endpoint URLs
    await expect(
      upsertPublishTarget(t.db, {
        ...c,
        provider: "wordpress",
        config: { endpointUrl: "http://127.0.0.1:8080/wp-json/wp/v2/posts" },
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      upsertPublishTarget(t.db, {
        ...c,
        provider: "webflow",
        config: { endpointUrl: "http://169.254.169.254/latest/meta-data" },
      }),
    ).rejects.toBeInstanceOf(DomainError);

    // Connects WordPress target and masks secret token
    const wpTarget = await upsertPublishTarget(t.db, {
      ...c,
      provider: "wordpress",
      config: {
        endpointUrl: "https://cms.canvasly.io/wp-json/wp/v2/posts",
        apiToken: "wp_secret_token_123456",
      },
    });
    expect(wpTarget.config.apiToken).toBe("wp_••••••••");

    // Updating with masked token preserves original secret in DB
    await upsertPublishTarget(t.db, {
      ...c,
      provider: "wordpress",
      config: {
        endpointUrl: "https://cms.canvasly.io/wp-json/wp/v2/posts",
        apiToken: "wp_••••••••",
        postStatus: "publish",
      },
    });
    const [rawTarget] = await t.db.select().from(publishTargets).where(eq(publishTargets.id, wpTarget.id));
    expect(rawTarget.config.apiToken).toBe("wp_secret_token_123456");

    // Publish content item across all 8 CMS providers (wordpress, webflow, contentful, sanity, wix, framer, payload, shopify)
    const item = await createContentItem(t.db, {
      ...c,
      title: "Multi-CMS Syndicated Guide",
      status: "idea",
    });

    for (const provider of CMS_PROVIDERS) {
      const pub = await publishContentItem(t.db, {
        ...c,
        contentId: item.id,
        provider,
      });
      expect(pub.item.status).toBe("published");
      expect(pub.provider).toBe(provider);
      expect(pub.publishedVersion).toBeGreaterThanOrEqual(1);
    }

    const targets = await listPublishTargets(t.db, c);
    expect(targets.length).toBe(CMS_PROVIDERS.length);

    // Can disconnect a target
    const payloadTarget = targets.find((x) => x.provider === "payload")!;
    await deletePublishTarget(t.db, { ...c, targetId: payloadTarget.id });
    const afterDelete = await listPublishTargets(t.db, c);
    expect(afterDelete.map((x) => x.provider)).not.toContain("payload");
  });

  it("syncs Shopify catalog idempotently, generates AI product drafts + FAQs, and applies optimization", async () => {
    const sync1 = await syncShopifyCatalog(t.db, c);
    expect(sync1.created).toBeGreaterThanOrEqual(3);

    const sync2 = await syncShopifyCatalog(t.db, c);
    expect(sync2.created).toBe(0);

    const cat1 = await listCatalogProducts(t.db, c);
    expect(cat1.shopifyConnected).toBe(true);
    expect(cat1.products.length).toBeGreaterThanOrEqual(3);

    const firstProd = cat1.products[0]!;
    const draft = await generateCatalogProductDraft(t.db, {
      ...c,
      productId: firstProd.id,
    });
    expect(draft.recommendedTitle).toContain("Canvasly");
    expect(draft.recommendedDescription).toContain("Canvasly Pro pricing starts at $29 per month");
    expect(draft.recommendedFaq).toContain("Q:");

    const applied = await applyCatalogOptimizationToShopify(t.db, {
      ...c,
      productId: firstProd.id,
      title: draft.recommendedTitle,
      description: draft.recommendedDescription,
      faq: draft.recommendedFaq,
    });
    expect(applied.status).toBe("published");

    const cat2 = await listCatalogProducts(t.db, c);
    const updatedProd = cat2.products.find((p) => p.id === firstProd.id)!;
    expect(updatedProd.optimizationStatus).toBe("published");
    expect(updatedProd.titleScore).toBeGreaterThanOrEqual(95);
    expect(updatedProd.descScore).toBeGreaterThanOrEqual(95);
    expect(updatedProd.faqStatus).toBe("ok");

    // Rejects optimizing a competitor product (isOwn = false)
    const [compProd] = await t.db
      .insert(shoppingProducts)
      .values({
        websiteId: c.websiteId,
        title: "Figma Enterprise Seat",
        retailer: "Figma",
        price: "75.00",
        isOwn: false,
      })
      .returning();
    await expect(
      generateCatalogProductDraft(t.db, { ...c, productId: compProd.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("enforces tenant isolation and RBAC across Content Hub, CMS Publishing, and Catalog Optimization", async () => {
    await expect(listContentHub(t.db, { actorId: viewerId, websiteId: c.websiteId })).resolves.toBeTruthy();
    await expect(listCatalogProducts(t.db, { actorId: viewerId, websiteId: c.websiteId })).resolves.toBeTruthy();

    await expect(
      createContentItem(t.db, { actorId: viewerId, websiteId: c.websiteId, title: "Viewer Blocked" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      syncShopifyCatalog(t.db, { actorId: viewerId, websiteId: c.websiteId }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(listContentHub(t.db, { actorId: outsider.actorId, websiteId: c.websiteId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCatalogProducts(t.db, { actorId: outsider.actorId, websiteId: c.websiteId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      upsertPublishTarget(t.db, { actorId: outsider.actorId, websiteId: c.websiteId, provider: "wordpress" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
