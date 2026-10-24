/** Payload CMS REST API (self-hosted): create a published document with an API key. */
import { toLexical } from "../rich-text";
import { fieldKey, httpsUrl, oneOf, pattern, token, URL_PREFIX } from "./fields";
import { distinctFields, joinUrl, ok, rejected, safeId, send, type Json } from "./http";
import type { CmsPost, CmsProviderModule } from "./types";

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const body = (post: CmsPost, format: string) => (format === "markdown" ? post.markdown : format === "html" ? post.html : toLexical(post.blocks));

const payloadError = (json: Json) => {
  const first = Array.isArray(json.errors) ? json.errors[0] : null;
  if (!first) return json.message ?? null;
  const fields = Array.isArray(first.data?.errors) ? first.data.errors.map((e: { path?: string; message?: string }) => `${e.path}: ${e.message}`).join("; ") : "";
  return [first.message, fields].filter(Boolean).join(" — ");
};

export const payload: CmsProviderModule = {
  note: "Enable API keys on the auth collection (auth.useAPIKey) and give that user create access. Documents are sent with _status \"published\"; the body field holds Lexical rich text, Markdown or HTML, as chosen below.",
  fields: [
    { key: "serverUrl", label: "Server URL", required: true, parse: httpsUrl, placeholder: "https://cms.example.com" },
    { key: "collection", label: "Collection slug", required: true, defaultValue: "posts", parse: pattern(SLUG, "Use the collection slug, e.g. posts"), placeholder: "posts" },
    { key: "authCollection", label: "API key collection slug", required: true, defaultValue: "users", parse: pattern(SLUG, "Use the auth collection slug, e.g. users"), placeholder: "users" },
    { key: "apiKey", label: "API key", secret: true, required: true, parse: token(500), placeholder: "API key" },
    { key: "titleField", label: "Title field", required: true, defaultValue: "title", parse: fieldKey("Title field"), placeholder: "title" },
    { key: "slugField", label: "Slug field (optional)", required: false, defaultValue: "slug", parse: fieldKey("Slug field"), placeholder: "slug" },
    { key: "bodyField", label: "Body field", required: true, defaultValue: "content", parse: fieldKey("Body field"), placeholder: "content" },
    { key: "dateField", label: "Publish date field (optional)", required: false, defaultValue: "publishedAt", parse: fieldKey("Publish date field"), placeholder: "publishedAt" },
    { key: "bodyFormat", label: "Body field type", required: true, defaultValue: "lexical", options: ["lexical", "markdown", "html"], parse: oneOf(["lexical", "markdown", "html"], "Body field type") },
    URL_PREFIX,
  ],
  async publish(post, { cfg, request }) {
    distinctFields(cfg.titleField, cfg.slugField, cfg.bodyField, cfg.dateField);
    const doc = { [cfg.titleField]: post.title, ...(cfg.slugField ? { [cfg.slugField]: post.slug } : {}), ...(cfg.dateField ? { [cfg.dateField]: post.publishedAt } : {}), [cfg.bodyField]: body(post, cfg.bodyFormat), _status: "published" };
    const { status, json } = await send("payload", request, `${cfg.serverUrl}/api/${cfg.collection}`, {
      method: "POST",
      headers: { authorization: `${cfg.authCollection} API-Key ${cfg.apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(doc),
    });
    if (!ok(status)) throw rejected("payload", status, payloadError(json));
    return { url: joinUrl(cfg.urlPrefix, post.slug), remoteId: safeId(json.doc?.id), status };
  },
};
