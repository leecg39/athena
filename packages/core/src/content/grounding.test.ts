import { describe, expect, it } from "vitest";
import { templateBrief, templateDraft, pageToDraft, type GroundingContext } from "./grounding";

const empty: GroundingContext = { brand: "Canvasly", domain: "canvasly.io", facts: [], internalLinks: [], competitorNames: ["Figma", "Canva"], promptText: "best ai design tools" };
const INVENTED = /AI-native|predictable team pricing|Legacy vector workflows|General marketing templates|verified for enterprise|enterprise access controls|real-time collaboration/i;

describe("content templates", () => {
  it("never assert facts the workspace has not confirmed", () => {
    const brief = templateBrief({ title: "Best AI design tools", columns: { persona: "Design leads" } }, empty);
    const draft = templateDraft({ title: "Best AI design tools", columns: {} }, empty);
    for (const text of [brief, draft]) {
      expect(text).not.toMatch(INVENTED);
      expect(text).toMatch(/\[Add .*confirm.* Knowledge Base/i);
    }
    expect(brief).toContain("best ai design tools");
    expect(brief).toContain("Design leads");
    // competitors are named for comparison but never described
    expect(draft).toMatch(/\| Canvasly \| Figma \| Canva \|/);
    expect(draft).not.toMatch(/\| Primary Focus \|[^\n]*Legacy/);
    expect(draft).not.toContain("https://canvasly.io/pricing");
  });

  it("use confirmed facts and real internal links when they exist", () => {
    const ctx: GroundingContext = { ...empty, facts: ["Canvasly Pro costs $29 per month"], internalLinks: [{ url: "https://canvasly.io/pricing", title: "Pricing" }] };
    expect(templateBrief({ title: "Pricing guide", columns: {} }, ctx)).toContain("- Canvasly Pro costs $29 per month");
    const draft = templateDraft({ title: "Pricing guide", columns: {} }, ctx);
    expect(draft).toContain("Canvasly Pro costs $29 per month");
    expect(draft).toContain("[Pricing](https://canvasly.io/pricing)");
  });
});

describe("pageToDraft", () => {
  it("keeps the page's own title, headings, paragraphs and lists, dropping scripts and chrome", () => {
    const html = `<html><head><title>Security | Canvasly</title><script>var x = 1;</script></head><body><nav>Home Pricing</nav><main><h1>Security at Canvasly</h1><p>We encrypt data &amp; keys at rest.</p><ul><li>SOC 2 Type II</li><li>SSO</li></ul></main><footer>© 2026</footer></body></html>`;
    expect(pageToDraft(html)).toEqual({ title: "Security at Canvasly", body: "# Security at Canvasly\n\nWe encrypt data & keys at rest.\n\n- SOC 2 Type II\n- SSO" });
  });

  it("returns no body for pages without readable text", () => {
    expect(pageToDraft("<html><head><title>Empty</title></head><body><script>1</script></body></html>")).toEqual({ title: "Empty", body: "" });
  });
});
