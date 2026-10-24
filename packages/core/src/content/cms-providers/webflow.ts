/** Webflow Data API v2: create a live CMS collection item (published immediately). */
import { pattern, token, URL_PREFIX } from "./fields";
import { joinUrl, ok, rejected, safeId, send, type Json } from "./http";
import type { CmsProviderModule } from "./types";

const webflowError = (json: Json) => {
  const details = Array.isArray(json.details) ? json.details.map((d: unknown) => (typeof d === "string" ? d : JSON.stringify(d))) : [];
  return [json.message, ...details].filter(Boolean).join("; ");
};

export const webflow: CmsProviderModule = {
  note: "Create a site API token with CMS:write. Items are published to the live site right away (the site must have been published once).",
  fields: [
    { key: "apiToken", label: "API token (CMS:write)", secret: true, required: true, parse: token(500), placeholder: "Site token" },
    { key: "collectionId", label: "Collection ID", required: true, parse: pattern(/^[a-f0-9]{24}$/i, "The collection ID is the 24-character ID in the collection settings"), placeholder: "580e63fc8c9a982ac9b8b745" },
    { key: "bodyField", label: "Rich text field slug", required: true, defaultValue: "post-body", parse: pattern(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use the field's slug, e.g. post-body"), placeholder: "post-body" },
    URL_PREFIX,
  ],
  async publish(post, { cfg, request }) {
    const { status, json } = await send("webflow", request, `https://api.webflow.com/v2/collections/${cfg.collectionId}/items/live`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiToken}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ isArchived: false, isDraft: false, fieldData: { name: post.title, slug: post.slug, [cfg.bodyField]: post.html } }),
    });
    if (!ok(status)) throw rejected("webflow", status, webflowError(json));
    const slug = typeof json.fieldData?.slug === "string" ? json.fieldData.slug : post.slug;
    return { url: joinUrl(cfg.urlPrefix, slug), remoteId: safeId(json.id), status };
  },
};
