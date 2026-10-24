import type { Block } from "../markdown-ast";

/** Outgoing HTTP for publishing (the web layer passes the SSRF-safe fetcher). */
export type CmsRequest = (url: string, init: { method: "GET" | "POST" | "PUT" | "DELETE"; headers: Record<string, string>; body?: string }) => Promise<{ status: number; body: string }>;
export type CmsRequestInit = Parameters<CmsRequest>[1];

/** One connection field: how it is asked for and how a submitted value is checked. */
export interface FieldSpec {
  key: string;
  label: string;
  secret?: boolean;
  required: boolean;
  /** Validates and normalizes a submitted value (throws DomainError when it is not usable). */
  parse: (value: string, site: { domain: string }) => string;
  /** Stored when the field is left empty and nothing was saved before. */
  defaultValue?: string;
  /** Allowed values (shown as a select). */
  options?: readonly string[];
  placeholder?: string;
}

/** The latest version of a content item, prepared for every CMS format. */
export interface CmsPost {
  title: string;
  slug: string;
  markdown: string;
  html: string;
  blocks: Block[];
  /** ISO timestamp written to the CMS's publish-date field when one is configured. */
  publishedAt: string;
}

// ---- Framer Server API (framer-api); the web layer passes `connect` ----

export interface FramerFieldRef { id: string; name: string; type: string }
export interface FramerItemRef { id: string; slug: string }
export interface FramerHostname { hostname: string; type: string; isPrimary: boolean; isPublished: boolean }
export interface FramerDeployment { id: string; status: string; failureStage?: string }
export interface FramerCollectionRef {
  id: string;
  name: string;
  managedBy: string;
  getFields(): Promise<readonly FramerFieldRef[]>;
  getItems(): Promise<readonly FramerItemRef[]>;
  addItems(items: { slug: string; fieldData: Record<string, { type: "string"; value: string } | { type: "formattedText"; value: string; contentType: "html" }> }[]): Promise<void>;
}
export interface FramerProject {
  getCollections(): Promise<readonly FramerCollectionRef[]>;
  getUnpublishedPageChanges(): Promise<readonly { path: string; status: string }[]>;
  publish(): Promise<{ deployment: FramerDeployment; hostnames: readonly FramerHostname[] }>;
  getDeployment(deploymentId: string): Promise<FramerDeployment>;
  deploy(deploymentId: string): Promise<readonly FramerHostname[]>;
  disconnect(): Promise<void>;
}
export type FramerConnect = (projectId: string, apiKey: string) => Promise<FramerProject>;

export interface CmsContext {
  cfg: Record<string, string>;
  site: { domain: string };
  request: CmsRequest;
  framer: FramerConnect | null;
  /** Waits between status checks (tests pass an instant one). */
  sleep?: (ms: number) => Promise<void>;
}

/** Where the post now lives and its id on the CMS, from the CMS's own responses. */
export interface CmsOutcome {
  url: string | null;
  remoteId: string | null;
  /** HTTP status of the final accepting request (null for SDK-based publishing). */
  status: number | null;
}

export interface CmsProviderModule {
  fields: FieldSpec[];
  publish: (post: CmsPost, ctx: CmsContext) => Promise<CmsOutcome>;
  /** Shown next to the connection form. */
  note: string;
}
