import "server-only";
import { ZodError } from "zod";
import { DomainError } from "@athena/core/org";

/** Result shape returned by every form server action. */
export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
  /** one-time secret to display (API key, invite link) */
  secret?: string;
}

export const idle: ActionState = { ok: false };

/**
 * Run a mutation and convert expected failures into user-facing messages.
 * Unexpected errors are logged server-side and reported generically.
 */
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true, message: "Saved" };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    if (err instanceof ZodError) return { ok: false, error: err.issues.map((i) => i.message).join(", ") };
    // let Next.js control-flow errors (redirect/notFound) propagate
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
    console.error("[action] unexpected failure", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}
