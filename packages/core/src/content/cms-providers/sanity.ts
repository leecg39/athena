/** Sanity Mutations API: create a published document (an id without the "drafts." prefix). */
import { toPortableText } from "../rich-text";
import { fieldKey, oneOf, pattern, token, URL_PREFIX } from "./fields";
import { distinctFields, joinUrl, ok, rejected, safeId, send, type Json } from "./http";
import type { CmsPost, CmsProviderModule } from "./types";

const API_VERSION = "v2025-02-19";
const sanityError = (json: Json) => json.error?.description ?? json.message ?? (typeof json.error === "string" ? json.error : null);
const body = (post: CmsPost, format: string) => (format === "markdown" ? post.markdown : format === "html" ? post.html : toPortableText(post.blocks));

export const sanity: CmsProviderModule = {
  note: "Use an API token with Editor rights. The document is created published (not as a draft); the body field holds Portable Text, Markdown or HTML, as chosen below.",
  fields: [
    { key: "projectId", label: "Project ID", required: true, parse: pattern(/^[a-z0-9]{1,32}$/, "The project ID is shown in sanity.io/manage"), placeholder: "zp7mbokg" },
    { key: "dataset", label: "Dataset", required: true, defaultValue: "production", parse: pattern(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Use the dataset name, e.g. production"), placeholder: "production" },
    { key: "token", label: "API token (Editor)", secret: true, required: true, parse: token(500), placeholder: "sk…" },
    { key: "documentType", label: "Document type", required: true, defaultValue: "post", parse: pattern(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/, "Use the schema type name, e.g. post"), placeholder: "post" },
    { key: "titleField", label: "Title field", required: true, defaultValue: "title", parse: fieldKey("Title field"), placeholder: "title" },
    { key: "slugField", label: "Slug field (optional)", required: false, defaultValue: "slug", parse: fieldKey("Slug field"), placeholder: "slug" },
    { key: "bodyField", label: "Body field", required: true, defaultValue: "body", parse: fieldKey("Body field"), placeholder: "body" },
    { key: "dateField", label: "Publish date field (optional)", required: false, parse: fieldKey("Publish date field"), placeholder: "publishedAt" },
    { key: "bodyFormat", label: "Body field type", required: true, defaultValue: "portableText", options: ["portableText", "markdown", "html"], parse: oneOf(["portableText", "markdown", "html"], "Body field type") },
    URL_PREFIX,
  ],
  async publish(post, { cfg, request }) {
    distinctFields(cfg.titleField, cfg.slugField, cfg.bodyField, cfg.dateField);
    const doc = {
      _type: cfg.documentType,
      [cfg.titleField]: post.title,
      ...(cfg.slugField ? { [cfg.slugField]: { _type: "slug", current: post.slug } } : {}),
      ...(cfg.dateField ? { [cfg.dateField]: post.publishedAt } : {}),
      [cfg.bodyField]: body(post, cfg.bodyFormat),
    };
    const { status, json } = await send("sanity", request, `https://${cfg.projectId}.api.sanity.io/${API_VERSION}/data/mutate/${cfg.dataset}?returnIds=true&visibility=sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ mutations: [{ create: doc }] }),
    });
    if (!ok(status)) throw rejected("sanity", status, sanityError(json));
    return { url: joinUrl(cfg.urlPrefix, post.slug), remoteId: safeId(json.results?.[0]?.id), status };
  },
};
