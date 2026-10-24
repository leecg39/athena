import { DomainError } from "../../org/errors";
import { CMS_PROVIDER_LABELS, type CmsProvider } from "../shared";
import type { CmsRequest, CmsRequestInit } from "./types";

/** CMS responses are untyped JSON; every value read from them is checked where it is used. */
export type Json = Record<string, any>;

export function parseJson(body: string): Json {
  try {
    const v = JSON.parse(body);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export async function send(provider: CmsProvider, request: CmsRequest, url: string, init: CmsRequestInit): Promise<{ status: number; json: Json }> {
  let res: { status: number; body: string };
  try {
    res = await request(url, init);
  } catch {
    throw new DomainError(`Could not reach ${CMS_PROVIDER_LABELS[provider]}. Check the connection settings.`);
  }
  return { status: res.status, json: parseJson(res.body) };
}

export const ok = (status: number) => status >= 200 && status < 300;

/** Like send, but a request that gets no answer comes back as a failure value (so a draft from an earlier step can be cleaned up). */
export const sendOrFailure = (provider: CmsProvider, request: CmsRequest, url: string, init: CmsRequestInit) =>
  send(provider, request, url, init).catch((err: unknown) => (err instanceof DomainError ? err : new DomainError(String(err))));

const detailOf = (raw: unknown) => (raw ? `: ${(typeof raw === "string" ? raw : JSON.stringify(raw)).slice(0, 200)}` : "");

export function rejected(provider: CmsProvider, status: number, raw: unknown, what = "the post"): DomainError {
  return new DomainError(`${CMS_PROVIDER_LABELS[provider]} rejected ${what} (HTTP ${status})${detailOf(raw)}`);
}

/** After a later step failed: remove the draft created in an earlier step; the error to show says what is left. */
export async function cleanupFailure(provider: CmsProvider, failure: DomainError, remove: () => Promise<{ status: number }>, draftId: string): Promise<DomainError> {
  const removed = await remove().then((r) => ok(r.status), () => false);
  const label = CMS_PROVIDER_LABELS[provider];
  const what = failure.message.replace(/\.$/, "");
  return new DomainError(removed ? `${what}. The draft created in ${label} was removed.` : `${what}. The draft ${draftId} is still in ${label} — publish or delete it there.`);
}

/** Ids that come back from a CMS and go into a request path. */
export const safeId = (v: unknown): string | null => (typeof v === "string" || typeof v === "number") && /^[A-Za-z0-9_.-]{1,128}$/.test(String(v)) ? String(v) : null;

export const joinUrl = (prefix: string | undefined, slug: string) => (prefix ? `${prefix}/${encodeURIComponent(slug)}` : null);

export const httpsOnly = (v: unknown): string | null => (typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v) ? v : null);

/** Fails when two configured fields point at the same CMS field. */
export function distinctFields(...keys: (string | undefined)[]) {
  const used = keys.filter(Boolean);
  if (new Set(used).size !== used.length) throw new DomainError("Use different CMS fields for the title, slug and body");
}
