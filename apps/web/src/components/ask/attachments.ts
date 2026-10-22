export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_CHARS = 100_000;
export const MAX_MESSAGE_CHARS = 4_000;

export const ALLOWED_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "tsv", "json"]);
export const ACCEPT_ATTR = ".txt,.md,.markdown,.csv,.tsv,.json,text/plain,text/markdown,text/csv,text/tab-separated-values,application/json";

export interface DraftAttachment {
  name: string;
  text: string;
  size: number;
}

export function validateTextFile(
  name: string,
  text: string,
): { ok: true; attachment: DraftAttachment } | { ok: false; error: string } {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  const ext = dot > 0 ? trimmed.slice(dot + 1).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: "Only text files (TXT, MD, CSV, TSV, JSON) can be attached." };
  }
  if (text.includes("\u0000")) {
    return { ok: false, error: `${trimmed} looks like a binary file.` };
  }
  if (text.length > MAX_ATTACHMENT_CHARS) {
    return { ok: false, error: `${trimmed} exceeds the ${MAX_ATTACHMENT_CHARS.toLocaleString("en-US")}-character limit.` };
  }
  return { ok: true, attachment: { name: trimmed, text, size: text.length } };
}

export function mergeAttachments(
  current: DraftAttachment[],
  incoming: DraftAttachment[],
): { attachments: DraftAttachment[]; error: string | null } {
  const next = [...current];
  for (const item of incoming) {
    const idx = next.findIndex((x) => x.name === item.name);
    if (idx !== -1) {
      next[idx] = item;
      continue;
    }
    if (next.length >= MAX_ATTACHMENTS) {
      return { attachments: next, error: `Attach at most ${MAX_ATTACHMENTS} files per message.` };
    }
    next.push(item);
  }
  return { attachments: next, error: null };
}

export async function readBrowserFiles(
  current: DraftAttachment[],
  files: FileList | File[],
): Promise<{ attachments: DraftAttachment[]; error: string | null }> {
  const parsed: DraftAttachment[] = [];
  for (const file of Array.from(files)) {
    if (file.size > MAX_ATTACHMENT_CHARS * 4) {
      return {
        attachments: current,
        error: `${file.name} exceeds the ${MAX_ATTACHMENT_CHARS.toLocaleString("en-US")}-character limit.`,
      };
    }
    const text = await file.text();
    const res = validateTextFile(file.name, text);
    if (!res.ok) return { attachments: current, error: res.error };
    parsed.push(res.attachment);
  }
  return mergeAttachments(current, parsed);
}
