import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("Astro Marketing Site, Docs Site & 4-Project Vercel Deployment Configs (Task 23)", () => {
  it("validates all 4 Vercel project manifests (web, marketing, docs, mcp)", () => {
    const projects = [
      { dir: "apps/web", filter: "@athena/web" },
      { dir: "apps/marketing", filter: "@athena/marketing" },
      { dir: "apps/docs", filter: "@athena/docs" },
      { dir: "apps/mcp", filter: "@athena/mcp" },
    ];

    for (const p of projects) {
      const vercelPath = path.join(REPO_ROOT, p.dir, "vercel.json");
      expect(fs.existsSync(vercelPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(vercelPath, "utf8")) as {
        buildCommand?: string;
        installCommand?: string;
        outputDirectory?: string;
      };
      expect(parsed.buildCommand).toContain(p.filter);
      expect(parsed.installCommand).toBe("npm install");
      if (p.dir !== "apps/web") {
        expect(parsed.outputDirectory).toBe("dist");
      }
    }
  });

  it("verifies all 7 self-branded Astro marketing pages (Home, Platform, Pricing, Industries, Comparison, Case Studies, Blog)", () => {
    const pages = [
      "index.astro",
      "platform.astro",
      "pricing.astro",
      "industries.astro",
      "comparison.astro",
      "case-studies.astro",
      "blog.astro",
    ];

    for (const page of pages) {
      const filePath = path.join(REPO_ROOT, "apps/marketing/src/pages", page);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toContain("Athenum");
      expect(content).not.toContain("content coming from the workspace CMS");
      expect(content).not.toContain("/signup");
    }

    const baseLayout = fs.readFileSync(
      path.join(REPO_ROOT, "apps/marketing/src/layouts/Base.astro"),
      "utf8",
    );
    const navigationTargets = [...baseLayout.matchAll(/href=\{hrefFor\("([^"]+)"\)\}/g)].map((match) => match[1]);
    expect(navigationTargets).toEqual(expect.arrayContaining([
      "/platform", "/pricing", "/industries", "/comparison", "/case-studies", "/blog",
    ]));
  });

  it("verifies all 7 Astro documentation pages including /api and /mcp", () => {
    const docPages = [
      "index.astro",
      "prompts.astro",
      "knowledge-base.astro",
      "oracle.astro",
      "integrations.astro",
      "api.astro",
      "mcp.astro",
    ];

    for (const page of docPages) {
      const filePath = path.join(REPO_ROOT, "apps/docs/src/pages", page);
      expect(fs.existsSync(filePath)).toBe(true);
    }

    const apiDoc = fs.readFileSync(
      path.join(REPO_ROOT, "apps/docs/src/pages/api.astro"),
      "utf8",
    );
    expect(apiDoc).toContain("/api/v1/connectors/{looker-studio|power-bi}");
    expect(apiDoc).toContain("/api/v1/kb");
    expect(apiDoc).toContain("/api/v1/teams");

    const mcpDoc = fs.readFileSync(
      path.join(REPO_ROOT, "apps/docs/src/pages/mcp.astro"),
      "utf8",
    );
    expect(mcpDoc).toContain("get_bi_connector_feed");
    expect(mcpDoc).toContain("get_knowledge_base");
  });
});
