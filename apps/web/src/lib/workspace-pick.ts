/** Choose the active website: the preferred one if accessible, else the first. */
export function pickWebsite<T extends { id: string }>(sites: readonly T[], preferredId: string | undefined): T | null {
  if (!sites.length) return null;
  return sites.find((s) => s.id === preferredId) ?? sites[0];
}
