"use server";

import { revalidatePath } from "next/cache";
import { db } from "@athena/db";
import {
  createPillar,
  updatePillar,
  deletePillar,
  createFact,
  updateFact,
  reviewFact,
  deleteFact,
  extractKnowledgeFacts,
  upsertInternalLink,
  deleteInternalLink,
  syncInternalLinks,
  type FactStatus,
} from "@athena/core/knowledge";
import { requireWorkspace } from "@/lib/workspace";
import { runAction, str, type ActionState } from "@/lib/action-state";
import { kbLimiter } from "@/lib/limits";

function revalidateKb() {
  revalidatePath("/knowledge-base");
  revalidatePath("/oracle");
}

export async function createPillarAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    if (!kbLimiter(ws.user.id).ok) return { ok: false, error: "Too many changes recently. Please wait a moment." };
    const p = await createPillar(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      name: str(fd, "name"),
      document: str(fd, "document") || null,
    });
    revalidateKb();
    return { ok: true, message: `Pillar "${p.name}" created.` };
  });
}

export async function updatePillarAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    const p = await updatePillar(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      pillarId: str(fd, "pillarId"),
      name: str(fd, "name") || undefined,
      document: fd.has("document") ? str(fd, "document") : undefined,
    });
    revalidateKb();
    return { ok: true, message: `Pillar "${p.name}" saved.` };
  });
}

export async function deletePillarAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    await deletePillar(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      pillarId: str(fd, "pillarId"),
    });
    revalidateKb();
    return { ok: true, message: "Pillar deleted." };
  });
}

export async function createFactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    if (!kbLimiter(ws.user.id).ok) return { ok: false, error: "Too many changes recently. Please wait a moment." };
    const rawStatus = str(fd, "status");
    const status: FactStatus = rawStatus === "pending_review" ? "pending_review" : "confirmed";
    await createFact(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      pillarId: str(fd, "pillarId"),
      claim: str(fd, "claim"),
      sourceUrl: str(fd, "sourceUrl") || null,
      status,
    });
    revalidateKb();
    return { ok: true, message: status === "confirmed" ? "Verified fact added." : "Claim added to approval queue." };
  });
}

export async function updateFactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    await updateFact(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      factId: str(fd, "factId"),
      pillarId: str(fd, "pillarId") || undefined,
      claim: str(fd, "claim") || undefined,
      sourceUrl: fd.has("sourceUrl") ? str(fd, "sourceUrl") || null : undefined,
    });
    revalidateKb();
    return { ok: true, message: "Fact updated." };
  });
}

export async function reviewFactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    const decision = str(fd, "decision") === "rejected" ? "rejected" : "confirmed";
    const claim = str(fd, "claim") || undefined;
    await reviewFact(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      factId: str(fd, "factId"),
      decision,
      claim,
    });
    revalidateKb();
    return { ok: true, message: decision === "confirmed" ? "Claim approved and added to Knowledge Base." : "Claim rejected." };
  });
}

export async function deleteFactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    await deleteFact(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      factId: str(fd, "factId"),
    });
    revalidateKb();
    return { ok: true, message: "Fact removed." };
  });
}

export async function extractFactsAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    if (!kbLimiter(ws.user.id).ok) return { ok: false, error: "Too many extractions recently. Please wait a moment." };
    const r = await extractKnowledgeFacts(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
    });
    revalidateKb();
    if (r.createdFacts === 0 && r.createdPillars === 0) {
      return { ok: true, message: "All discovered brand facts are already in your Knowledge Base." };
    }
    return { ok: true, message: `Extracted ${r.createdFacts} new claims (${r.createdPillars} new pillars).` };
  });
}

export async function upsertInternalLinkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    if (!kbLimiter(ws.user.id).ok) return { ok: false, error: "Too many changes recently. Please wait a moment." };
    const rawKeywords = str(fd, "keywords");
    const keywords = rawKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const saved = await upsertInternalLink(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      url: str(fd, "url"),
      title: str(fd, "title") || undefined,
      keywords,
    });
    revalidateKb();
    return { ok: true, message: `Internal link page "${saved.url}" saved.` };
  });
}

export async function deleteInternalLinkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    await deleteInternalLink(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
      linkId: str(fd, "linkId"),
    });
    revalidateKb();
    return { ok: true, message: "Internal link page removed." };
  });
}

export async function syncInternalLinksAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ws = await requireWorkspace();
    const r = await syncInternalLinks(db, {
      actorId: ws.user.id,
      websiteId: ws.websiteId,
    });
    revalidateKb();
    return {
      ok: true,
      message: r.created > 0 ? `Synced ${r.created} internal link pages from citations.` : "Internal link pages are already up to date.",
    };
  });
}
