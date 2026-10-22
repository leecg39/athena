import { DomainError } from "../org/errors";
import { normalizeUrl } from "../sources";

export function parseSourceUrlForOracle(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const normalized = normalizeUrl(raw.trim());
  if (!normalized) throw new DomainError("Source URL must be a valid http(s) URL");
  return normalized;
}
