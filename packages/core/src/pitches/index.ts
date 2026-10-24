/**
 * Pitch Workspace & agency groups (Task 19).
 *  - Pitches: prospect audits measured from AI answers collected for the
 *    prospect's buyer questions (1 credit per answer), optional AI rewrite of
 *    the prospect's own copy, public share links.
 *  - Groups: multi-website rollups from collected answers, saved views and a
 *    shared credit pool funded from the organization's credits.
 */
export * from "./pitch";
export * from "./metrics";
export { writePitchRewrite, type PitchRewriteWriter } from "./rewrite";
export { getPublicPitchByShareId, isPitchShareId, type PublicPitch } from "./public";
export * from "./groups";
