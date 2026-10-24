/** Public pitch links: the measured payload only (no organization or member data). */
import { and, eq, isNull } from "drizzle-orm";
import { type Db, pitches } from "@athena/db";
import { NotFoundError } from "../org/errors";
import { parsePitchPayload, type PitchPayload } from "./metrics";
import type { PitchKind } from "./pitch";

export interface PublicPitch {
  shareId: string;
  brandName: string;
  domain: string;
  websiteUrl: string;
  kind: PitchKind;
  createdAt: string;
  payload: PitchPayload;
}

const SHARE_ID = /^c?pitch_[0-9a-f]{16,64}$/;

export const isPitchShareId = (shareId: string) => SHARE_ID.test(shareId.trim());

export async function getPublicPitchByShareId(db: Db, shareId: string): Promise<PublicPitch> {
  const id = shareId.trim();
  if (!SHARE_ID.test(id)) throw new NotFoundError("Pitch not found");
  const [row] = await db.select().from(pitches).where(and(eq(pitches.shareId, id), isNull(pitches.deletedAt)));
  const payload = row ? parsePitchPayload(row.payload) : null;
  if (!row || !payload) throw new NotFoundError("Pitch not found");
  return { shareId: row.shareId, brandName: row.brandName, domain: payload.domain, websiteUrl: row.websiteUrl, kind: row.kind === "content" ? "content" : "visibility", createdAt: row.createdAt.toISOString(), payload };
}
