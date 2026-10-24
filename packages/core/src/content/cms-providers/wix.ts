/** Wix Blog: convert the HTML to Ricos, create a draft post, then publish it. */
import { DomainError } from "../../org/errors";
import { pattern, token } from "./fields";
import { cleanupFailure, httpsOnly, ok, rejected, safeId, send, sendOrFailure, type Json } from "./http";
import type { CmsProviderModule } from "./types";

const API = "https://www.wixapis.com";
const MAX_HTML = 30_000; // Convert To Ricos Document accepts at most 30,000 characters of HTML
const PLUGINS = ["HEADING", "LINK", "CODE_BLOCK", "TABLE", "DIVIDER"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wixError = (json: Json) => json.message ?? json.details?.applicationError?.description ?? null;

export const wix: CmsProviderModule = {
  note: "Create an API key with the Manage Blog and Manage Ricos Document permissions. Posts are written by the member you choose and published right away; if publishing fails, the draft is removed.",
  fields: [
    { key: "apiKey", label: "API key", secret: true, required: true, parse: token(4096), placeholder: "IST.…" },
    { key: "siteId", label: "Site ID", required: true, parse: pattern(UUID, "The site ID is the UUID in your dashboard URL"), placeholder: "2d24cb8a-adcc-466a-ab59-fa74e0889a37" },
    { key: "memberId", label: "Author member ID", required: true, parse: pattern(UUID, "Use the site member's ID (a UUID) who will be shown as the author"), placeholder: "8a8b9b73-4da8-47a5-8268-4396e68a0605" },
  ],
  async publish(post, { cfg, request }) {
    if (post.html.length > MAX_HTML) throw new DomainError("Wix converts at most 30,000 characters of HTML per post — shorten the draft first");
    const headers = { authorization: cfg.apiKey, "wix-site-id": cfg.siteId, "content-type": "application/json", accept: "application/json" };
    const converted = await send("wix", request, `${API}/ricos/v1/ricos-document/convert/to-ricos`, { method: "POST", headers, body: JSON.stringify({ html: post.html, options: { plugins: PLUGINS } }) });
    if (!ok(converted.status)) throw rejected("wix", converted.status, wixError(converted.json));
    if (!Array.isArray(converted.json.document?.nodes)) throw new DomainError("Wix returned no rich content for this draft");
    const draftPost = { title: post.title, memberId: cfg.memberId, seoSlug: post.slug, richContent: converted.json.document };
    const created = await send("wix", request, `${API}/blog/v3/draft-posts`, { method: "POST", headers, body: JSON.stringify({ draftPost, fieldsets: ["URL"] }) });
    if (!ok(created.status)) throw rejected("wix", created.status, wixError(created.json));
    const draft = created.json.draftPost ?? {};
    const id = safeId(draft.id);
    if (!id) throw new DomainError("Wix accepted the draft but returned no post ID");
    const published = await sendOrFailure("wix", request, `${API}/blog/v3/draft-posts/${id}/publish`, { method: "POST", headers, body: "{}" });
    if (published instanceof DomainError || !ok(published.status)) {
      const failure = published instanceof DomainError ? published : rejected("wix", published.status, wixError(published.json), "publishing");
      throw await cleanupFailure("wix", failure, () => request(`${API}/blog/v3/draft-posts/${id}`, { method: "DELETE", headers }), id);
    }
    const base = httpsOnly(draft.url?.base);
    const url = base && typeof draft.url?.path === "string" && draft.url.path.startsWith("/") ? `${base.replace(/\/+$/, "")}${draft.url.path}` : null;
    return { url, remoteId: safeId(published.json.postId) ?? id, status: published.status };
  },
};
