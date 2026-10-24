/** Contentful Content Management API: create an entry, then publish that version. */
import { DomainError } from "../../org/errors";
import { toContentfulRichText } from "../rich-text";
import { fieldKey, oneOf, pattern, token, URL_PREFIX } from "./fields";
import { cleanupFailure, distinctFields, joinUrl, ok, rejected, safeId, send, sendOrFailure, type Json } from "./http";
import type { CmsPost, CmsProviderModule } from "./types";

const CMA_JSON = "application/vnd.contentful.management.v1+json";

const contentfulError = (json: Json) => {
  const first = json.details?.errors?.[0];
  const where = first ? ` (${[first.name, Array.isArray(first.path) ? first.path.join(".") : null, typeof first.details === "string" ? first.details : null].filter(Boolean).join(" ")})` : "";
  return json.message ? `${json.message}${where}` : null;
};

function entryFields(post: CmsPost, cfg: Record<string, string>) {
  distinctFields(cfg.titleField, cfg.slugField, cfg.bodyField, cfg.dateField);
  const at = (value: unknown) => ({ [cfg.locale]: value });
  return {
    [cfg.titleField]: at(post.title),
    ...(cfg.slugField ? { [cfg.slugField]: at(post.slug) } : {}),
    ...(cfg.dateField ? { [cfg.dateField]: at(post.publishedAt) } : {}),
    [cfg.bodyField]: at(cfg.bodyFormat === "richtext" ? toContentfulRichText(post.blocks) : post.markdown),
  };
}

export const contentful: CmsProviderModule = {
  note: "Use a personal access token (CMA). The body field must be Long text (Markdown) or Rich Text, as chosen below. If publishing fails, the draft entry is removed.",
  fields: [
    { key: "managementToken", label: "Content Management API token", secret: true, required: true, parse: token(500), placeholder: "CFPAT-…" },
    { key: "spaceId", label: "Space ID", required: true, parse: pattern(/^[a-zA-Z0-9]{1,64}$/, "The space ID is shown under Settings → General settings"), placeholder: "yadj1kx9rmg0" },
    { key: "environmentId", label: "Environment ID", required: true, defaultValue: "master", parse: pattern(/^[a-zA-Z0-9_.-]{1,64}$/, "Use the environment ID, e.g. master"), placeholder: "master" },
    { key: "contentTypeId", label: "Content type ID", required: true, parse: pattern(/^[a-zA-Z0-9_.-]{1,64}$/, "Use the content type's API identifier"), placeholder: "blogPost" },
    { key: "titleField", label: "Title field ID", required: true, defaultValue: "title", parse: fieldKey("Title field ID"), placeholder: "title" },
    { key: "bodyField", label: "Body field ID", required: true, defaultValue: "body", parse: fieldKey("Body field ID"), placeholder: "body" },
    { key: "bodyFormat", label: "Body field type", required: true, defaultValue: "markdown", options: ["markdown", "richtext"], parse: oneOf(["markdown", "richtext"], "Body field type") },
    { key: "slugField", label: "Slug field ID (optional)", required: false, parse: fieldKey("Slug field ID"), placeholder: "slug" },
    { key: "dateField", label: "Publish date field (optional)", required: false, parse: fieldKey("Publish date field"), placeholder: "publishDate" },
    { key: "locale", label: "Locale", required: true, defaultValue: "en-US", parse: pattern(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,2}$/, "Use a locale code such as en-US"), placeholder: "en-US" },
    { key: "region", label: "Data region", required: true, defaultValue: "us", options: ["us", "eu"], parse: oneOf(["us", "eu"], "Data region") },
    URL_PREFIX,
  ],
  async publish(post, { cfg, request }) {
    const fields = entryFields(post, cfg);
    const entries = `${cfg.region === "eu" ? "https://api.eu.contentful.com" : "https://api.contentful.com"}/spaces/${cfg.spaceId}/environments/${cfg.environmentId}/entries`;
    const auth = { authorization: `Bearer ${cfg.managementToken}` };
    const created = await send("contentful", request, entries, { method: "POST", headers: { ...auth, "content-type": CMA_JSON, "x-contentful-content-type": cfg.contentTypeId }, body: JSON.stringify({ fields }) });
    if (!ok(created.status)) throw rejected("contentful", created.status, contentfulError(created.json));
    const id = safeId(created.json.sys?.id);
    const version = created.json.sys?.version;
    if (!id || typeof version !== "number") throw new DomainError("Contentful accepted the entry but returned no entry ID or version");
    const versioned = { ...auth, "x-contentful-version": String(version) };
    const published = await sendOrFailure("contentful", request, `${entries}/${id}/published`, { method: "PUT", headers: versioned });
    if (published instanceof DomainError || !ok(published.status)) {
      const failure = published instanceof DomainError ? published : rejected("contentful", published.status, contentfulError(published.json), "publishing");
      throw await cleanupFailure("contentful", failure, () => request(`${entries}/${id}`, { method: "DELETE", headers: versioned }), id);
    }
    return { url: joinUrl(cfg.urlPrefix, post.slug), remoteId: id, status: published.status };
  },
};
