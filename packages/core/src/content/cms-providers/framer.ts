/**
 * Framer Server API: add a CMS item, publish the project and promote it to the
 * custom domain. Publishing a Framer site publishes every pending change, so
 * this refuses to run while the project has unpublished page changes.
 */
import { DomainError } from "../../org/errors";
import { text, token, URL_PREFIX } from "./fields";
import { joinUrl } from "./http";
import type { CmsPost, CmsProviderModule, FramerCollectionRef, FramerDeployment, FramerHostname, FramerProject } from "./types";

const PROJECT_ID = /^[A-Za-z0-9]{20}$/;
const POLL_MS = 2_000;
const POLLS = 10;
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);
type Sleep = (ms: number) => Promise<void>;

/** A project URL (https://framer.com/projects/Name--<id>) or a bare 20-character project ID → the ID. */
export function framerProjectId(v: string): string {
  const s = v.trim();
  if (PROJECT_ID.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new DomainError("Paste the project URL from the Framer editor (https://framer.com/projects/…)");
  }
  const seg = u.hostname === "framer.com" || u.hostname === "www.framer.com" ? u.pathname.split("/").filter(Boolean) : [];
  const raw = seg[0]?.toLowerCase() === "projects" && seg[1] ? decodeURIComponent(seg[1]) : "";
  const id = raw.match(/^.+--([A-Za-z0-9]+)$/)?.[1] ?? raw;
  if (!PROJECT_ID.test(id)) throw new DomainError("Paste the project URL from the Framer editor (https://framer.com/projects/…)");
  return id;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function resolveTarget(project: FramerProject, cfg: Record<string, string>) {
  const collections = await project.getCollections();
  const collection = collections.find((c) => c.id === cfg.collection || same(c.name, cfg.collection));
  if (!collection) throw new DomainError(`No CMS collection "${cfg.collection}" in this Framer project (found: ${collections.map((c) => c.name).join(", ") || "none"})`);
  if (collection.managedBy !== "user") throw new DomainError(`The "${collection.name}" collection is managed by a plugin and can't be edited`);
  const fields = await collection.getFields();
  const pick = (name: string, type: string, label: string) => {
    const f = fields.find((x) => x.type === type && same(x.name, name));
    if (!f) throw new DomainError(`No ${label} field "${name}" in ${collection.name} (available: ${fields.filter((x) => x.type === type).map((x) => x.name).join(", ") || "none"})`);
    return f;
  };
  return { collection, title: pick(cfg.titleField, "string", "plain text"), body: pick(cfg.bodyField, "formattedText", "formatted text") };
}

async function addItem(collection: FramerCollectionRef, post: CmsPost, titleId: string, bodyId: string): Promise<string | null> {
  if ((await collection.getItems()).some((i) => i.slug === post.slug)) throw new DomainError(`An item with the slug "${post.slug}" already exists in ${collection.name}`);
  await collection.addItems([{ slug: post.slug, fieldData: { [titleId]: { type: "string", value: post.title }, [bodyId]: { type: "formattedText", value: post.html, contentType: "html" } } }]);
  return (await collection.getItems()).find((i) => i.slug === post.slug)?.id ?? null;
}

const liveHost = (hosts: readonly FramerHostname[]) => hosts.find((h) => h.isPublished && h.type === "custom") ?? hosts.find((h) => h.isPublished && h.type === "default") ?? null;

/** publish() returns before the deployment is live: follow it while it is still "pending". */
async function settled(project: FramerProject, d: FramerDeployment, sleep: Sleep, left = POLLS): Promise<FramerDeployment> {
  if (d.status !== "pending" || left === 0) return d;
  await sleep(POLL_MS);
  return settled(project, await project.getDeployment(d.id), sleep, left - 1);
}

/** Promotes the deployment to the custom domain; a production publish without one is already live. */
async function promote(project: FramerProject, deploymentId: string, published: readonly FramerHostname[], collection: string): Promise<readonly FramerHostname[]> {
  try {
    return [...(await project.deploy(deploymentId)), ...published];
  } catch (err) {
    if (liveHost(published)) return published;
    throw new DomainError(`Framer published the site but couldn't promote it to your domain: ${errText(err)}. The post was added to the ${collection} collection.`);
  }
}

async function publishItem(project: FramerProject, post: CmsPost, cfg: Record<string, string>, sleep: Sleep) {
  const pending = await project.getUnpublishedPageChanges();
  if (pending.length) throw new DomainError(`Your Framer project has ${pending.length} unpublished page change(s). Publish or discard them in Framer first, so only this post goes live.`);
  const { collection, title, body } = await resolveTarget(project, cfg);
  const remoteId = await addItem(collection, post, title.id, body.id);
  const page = (await project.getUnpublishedPageChanges()).find((c) => c.status === "added" && c.path.endsWith(`/${post.slug}`));
  const result = await project.publish().catch((err: unknown) => {
    throw new DomainError(`Framer added the post to the ${collection.name} collection but couldn't publish the site: ${errText(err)}`);
  });
  const deployment = await settled(project, result.deployment, sleep);
  if (deployment.status === "failed") throw new DomainError(`Framer couldn't publish the site (${deployment.failureStage ?? "publish"} step). The post was added to the ${collection.name} collection — publish it from Framer.`);
  if (deployment.status === "pending") throw new DomainError(`Framer is still publishing the site. The post was added to the ${collection.name} collection and goes live when the deployment finishes — then use “Check page & mark published”.`);
  const host = liveHost(await promote(project, deployment.id, result.hostnames, collection.name));
  const url = page && host ? `https://${host.hostname}${page.path}` : joinUrl(cfg.urlPrefix, post.slug);
  return { url, remoteId, status: null };
}

export const framer: CmsProviderModule = {
  note: "Create an API key in Site Settings → General. Publishing adds the post to the collection and publishes the whole project to your domain, so Athenum refuses while other unpublished changes exist.",
  fields: [
    { key: "projectId", label: "Project URL", required: true, parse: framerProjectId, placeholder: "https://framer.com/projects/Site--…" },
    { key: "apiKey", label: "API key", secret: true, required: true, parse: token(500), placeholder: "API key" },
    { key: "collection", label: "CMS collection", required: true, defaultValue: "Blog", parse: text(100), placeholder: "Blog" },
    { key: "titleField", label: "Title field (plain text)", required: true, defaultValue: "Title", parse: text(100), placeholder: "Title" },
    { key: "bodyField", label: "Body field (formatted text)", required: true, defaultValue: "Content", parse: text(100), placeholder: "Content" },
    URL_PREFIX,
  ],
  async publish(post, { cfg, framer: connect, sleep }) {
    if (!connect) throw new DomainError("Framer publishing isn't available on this server");
    let project: FramerProject;
    try {
      project = await connect(cfg.projectId, cfg.apiKey);
    } catch (err) {
      throw new DomainError(`Could not connect to Framer: ${errText(err)}`);
    }
    try {
      return await publishItem(project, post, cfg, sleep ?? realSleep);
    } catch (err) {
      if (err instanceof DomainError) throw err;
      throw new DomainError(`Framer rejected the post: ${errText(err)}`);
    } finally {
      await project.disconnect().catch(() => undefined);
    }
  },
};
