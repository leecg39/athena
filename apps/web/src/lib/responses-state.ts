/** URL ⇄ Responses-browser state (lenient: invalid values are dropped). */
import { parseDashboardState, stateToFilters, stateToSearchParams, type DashboardState } from "@athena/core/analytics";
import type { ResponseFilters } from "@athena/core/analytics";

export interface ResponsesState {
  base: DashboardState;
  mentioned?: boolean;
  cited?: boolean;
  competitorId?: string;
  q?: string;
  view: "table" | "matrix";
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const yesNo = (v: unknown) => (v === "yes" ? true : v === "no" ? false : undefined);

export function parseResponsesState(params: Record<string, string | undefined>): ResponsesState {
  const page = Number.parseInt(params.page ?? "1", 10);
  return {
    base: parseDashboardState(params),
    mentioned: yesNo(params.mentioned),
    cited: yesNo(params.cited),
    competitorId: params.competitorId && UUID.test(params.competitorId) ? params.competitorId : undefined,
    q: params.q?.trim().slice(0, 200) || undefined,
    view: params.view === "matrix" ? "matrix" : "table",
    page: Number.isFinite(page) && page > 0 && page < 100_000 ? page : 1,
  };
}

export function responsesFilters(s: ResponsesState, now = new Date()): ResponseFilters {
  return { ...stateToFilters(s.base, now).current, mentioned: s.mentioned, cited: s.cited, competitorId: s.competitorId, q: s.q };
}

export function responsesQuery(s: ResponsesState, patch: Partial<Omit<ResponsesState, "base">> = {}): string {
  const next = { ...s, ...patch };
  const p = stateToSearchParams(next.base);
  p.delete("cards");
  p.delete("chart");
  if (next.mentioned !== undefined) p.set("mentioned", next.mentioned ? "yes" : "no");
  if (next.cited !== undefined) p.set("cited", next.cited ? "yes" : "no");
  if (next.competitorId) p.set("competitorId", next.competitorId);
  if (next.q) p.set("q", next.q);
  if (next.view === "matrix") p.set("view", "matrix");
  if (next.page > 1) p.set("page", String(next.page));
  return p.toString();
}
