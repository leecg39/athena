import { describe, expect, it } from "vitest";
import { pickWebsite } from "./workspace-pick";
import { isPublicPath, safeRedirect } from "./auth.config";

const sites = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
];

describe("pickWebsite", () => {
  it("honours the preferred id only when the user can access it", () => {
    expect(pickWebsite(sites, "b")?.id).toBe("b");
    expect(pickWebsite(sites, "someone-elses-site")?.id).toBe("a");
    expect(pickWebsite(sites, undefined)?.id).toBe("a");
  });
  it("returns null when the user has no websites", () => {
    expect(pickWebsite([], "a")).toBeNull();
  });
});

describe("auth path rules", () => {
  it("keeps app pages private and share/API-key routes public", () => {
    expect(isPublicPath("/olympus")).toBe(false);
    expect(isPublicPath("/api/athena/chat")).toBe(false);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/report/abc")).toBe(true);
    expect(isPublicPath("/api/v1/prompts")).toBe(true);
    expect(isPublicPath("/loginx")).toBe(false);
  });
  it("rejects open redirects", () => {
    expect(safeRedirect("/prompts?tab=x")).toBe("/prompts?tab=x");
    expect(safeRedirect("//evil.com")).toBe("/home");
    expect(safeRedirect("https://evil.com")).toBe("/home");
    expect(safeRedirect("/\\evil.com")).toBe("/home");
    expect(safeRedirect(undefined)).toBe("/home");
  });
});
