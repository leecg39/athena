import { and, eq, isNull } from "drizzle-orm";
import { db, locations, personas } from "@athena/db";
import type { WebsiteRow } from "@athena/core/tenancy";
import { ActionForm } from "@/components/action-form";
import { personaSuggestions } from "@/lib/onboarding-suggestions";
import { saveAudienceStep } from "../actions";
import { SourceNote } from "./frame";

const COUNTRIES = ["US", "GB", "CA", "AU", "DE", "FR", "ES", "IT", "NL", "SE", "JP", "KR", "SG", "IN", "BR", "MX"];

export async function AudienceStep({ site }: { site: WebsiteRow }) {
  const [locs, pers, suggestions] = await Promise.all([
    db.select().from(locations).where(and(eq(locations.websiteId, site.id), isNull(locations.deletedAt))),
    db.select().from(personas).where(and(eq(personas.websiteId, site.id), isNull(personas.deletedAt))),
    personaSuggestions(site),
  ]);
  const have = new Set(pers.map((p) => p.name.toLowerCase()));
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const options = COUNTRIES.includes(site.country) ? COUNTRIES : [site.country, ...COUNTRIES];
  return (
    <ActionForm action={saveAudienceStep} submitLabel="Save and continue" className="space-y-5">
      <input type="hidden" name="websiteId" value={site.id} />
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600">Primary market</span>
        <select name="country" className="input" defaultValue={site.country}>
          {options.map((c) => (
            <option key={c} value={c}>
              {names.of(c) ?? c} ({c})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600">Locations to track (optional, one per line — e.g. cities or regions)</span>
        <textarea name="locations" className="input" rows={3} defaultValue={locs.map((l) => l.name).join("\n")} />
      </label>
      <div className="space-y-2">
        <span className="block text-xs font-medium text-gray-600">Buyer personas</span>
        <SourceNote source={suggestions.source} provider={suggestions.provider} />
        {pers.length ? <p className="text-xs text-gray-500">Saved: {pers.map((p) => p.name).join(", ")}</p> : null}
        {suggestions.data
          .filter((p) => !have.has(p.name.toLowerCase()))
          .map((p) => (
            <label key={p.name} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="suggested" value={`${p.name}|${p.description}`} defaultChecked className="mt-1" />
              <span>
                <span className="font-medium">{p.name}</span> <span className="text-gray-500">— {p.description}</span>
              </span>
            </label>
          ))}
        <textarea name="manual" className="input" rows={3} placeholder={"Persona name: short description\nHead of Marketing: owns brand visibility"} />
      </div>
    </ActionForm>
  );
}
