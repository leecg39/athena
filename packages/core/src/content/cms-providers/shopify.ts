/** Shopify Admin REST API: blog articles. */
import { DomainError } from "../../org/errors";
import { text } from "./fields";
import { ok, rejected, send } from "./http";
import type { CmsProviderModule } from "./types";

const SHOPIFY_API_VERSION = "2025-01";

export const shopify: CmsProviderModule = {
  note: "Use a custom app's Admin API token with write_content access. Articles are published immediately.",
  fields: [
    { key: "storeDomain", label: "Store domain (*.myshopify.com)", required: true, placeholder: "your-store.myshopify.com", parse: (v) => { if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(v.trim())) throw new DomainError("Use the store's *.myshopify.com domain"); return v.trim().toLowerCase(); } },
    { key: "blogId", label: "Blog ID", required: true, placeholder: "123456789", parse: (v) => { if (!/^\d{1,20}$/.test(v.trim())) throw new DomainError("The blog ID is the number in the blog's admin URL"); return v.trim(); } },
    { key: "accessToken", label: "Admin API access token", secret: true, required: true, parse: text(200), placeholder: "shpat_…" },
    { key: "blogHandle", label: "Blog handle (for public links)", required: false, placeholder: "news", parse: (v) => { if (!/^[a-z0-9-]{1,100}$/.test(v.trim())) throw new DomainError("The blog handle uses lowercase letters, numbers and dashes"); return v.trim(); } },
  ],
  async publish(post, { cfg, request, site }) {
    const { status, json } = await send("shopify", request, `https://${cfg.storeDomain}/admin/api/${SHOPIFY_API_VERSION}/blogs/${cfg.blogId}/articles.json`, {
      method: "POST",
      headers: { "x-shopify-access-token": cfg.accessToken, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ article: { title: post.title, body_html: post.html, published: true } }),
    });
    if (!ok(status)) throw rejected("shopify", status, json.errors);
    const a = json.article ?? {};
    const url = cfg.blogHandle && typeof a.handle === "string" ? `https://${site.domain}/blogs/${cfg.blogHandle}/${a.handle}` : null;
    return { url, remoteId: a.id != null ? String(a.id) : null, status };
  },
};
