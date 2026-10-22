import { describe, expect, it } from "vitest";
import { isUniqueViolation, runAction } from "./action-state";
import { DomainError } from "@athena/core/org";

describe("runAction", () => {
  it("maps domain errors and wrapped unique violations to messages", async () => {
    await expect(runAction(async () => { throw new DomainError("nope"); })).resolves.toEqual({ ok: false, error: "nope" });
    const wrapped = Object.assign(new Error("query failed"), { cause: { code: "23505" } });
    expect(isUniqueViolation(wrapped)).toBe(true);
    await expect(runAction(async () => { throw wrapped; })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) });
    expect(isUniqueViolation(new Error("x"))).toBe(false);
  });
  it("rethrows Next.js control-flow errors", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x;307;" });
    await expect(runAction(async () => { throw redirect; })).rejects.toBe(redirect);
  });
});
