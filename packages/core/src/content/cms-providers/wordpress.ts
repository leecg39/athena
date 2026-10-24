/** WordPress REST API (wp/v2/posts) with an Application Password. */
import { httpsUrl, text } from "./fields";
import { ok, rejected, send } from "./http";
import type { CmsProviderModule } from "./types";

export const wordpress: CmsProviderModule = {
  note: "Create an Application Password under Users → Profile. Posts are published immediately.",
  fields: [
    { key: "siteUrl", label: "Site URL", required: true, parse: httpsUrl, placeholder: "https://blog.example.com" },
    { key: "username", label: "Username", required: true, parse: text(100), placeholder: "editor" },
    { key: "applicationPassword", label: "Application password", secret: true, required: true, parse: text(200), placeholder: "xxxx xxxx xxxx xxxx" },
  ],
  async publish(post, { cfg, request }) {
    const { status, json } = await send("wordpress", request, `${cfg.siteUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.applicationPassword}`).toString("base64")}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ title: post.title, status: "publish", slug: post.slug, content: post.html }),
    });
    if (!ok(status)) throw rejected("wordpress", status, json.message);
    const link = typeof json.link === "string" && /^https?:\/\//.test(json.link) ? json.link : null;
    return { url: link, remoteId: json.id != null ? String(json.id) : null, status };
  },
};
