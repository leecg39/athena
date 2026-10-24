/** Every CMS Athenum publishes to directly, with its connection fields and publish flow. */
import type { CmsProvider } from "../shared";
import { contentful } from "./contentful";
import { framer } from "./framer";
import { payload } from "./payload";
import { sanity } from "./sanity";
import { shopify } from "./shopify";
import type { CmsProviderModule } from "./types";
import { webflow } from "./webflow";
import { wix } from "./wix";
import { wordpress } from "./wordpress";

export const PROVIDERS: Record<CmsProvider, CmsProviderModule> = { wordpress, webflow, contentful, sanity, wix, framer, payload, shopify };

export type { CmsContext, CmsOutcome, CmsPost, CmsProviderModule, CmsRequest, FieldSpec, FramerCollectionRef, FramerConnect, FramerProject } from "./types";
export { framerProjectId } from "./framer";
