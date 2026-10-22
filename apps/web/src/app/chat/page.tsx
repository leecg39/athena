import { db } from "@athena/db";
import { getThread, listThreads, RUN_TIMEOUT_MS } from "@athena/core/assistant";
import { NotFoundError } from "@athena/core/org";
import { requireWorkspace } from "@/lib/workspace";
import { connectorsFor } from "@/lib/assistant";
import { AthChat, type ChatThreadView } from "@/components/ath-chat";

export const metadata = { title: "Ask Athena" };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; q?: string; gsc?: string }>;
}) {
  const ws = await requireWorkspace();
  const sp = await searchParams;
  const actor = { actorId: ws.user.id, websiteId: ws.websiteId };

  const [connectors, threads] = await Promise.all([
    connectorsFor(ws),
    listThreads(db, { ...actor, limit: 30 }),
  ]);

  let initialThread: ChatThreadView | null = null;
  let notFoundError: string | null = null;

  if (sp.id) {
    try {
      const { thread, messages } = await getThread(db, { ...actor, threadId: sp.id });
      const busy =
        thread.runningSince !== null &&
        Date.now() - thread.runningSince.getTime() < RUN_TIMEOUT_MS;
      initialThread = {
        id: thread.id,
        title: thread.title,
        busy,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
          attachments: m.attachments.map((a) => ({ name: a.name, type: a.type, size: a.size })),
          toolCalls: m.toolCalls.map((tc) => ({ name: tc.name, status: tc.ok ? "done" : "error" })),
          provider: m.provider,
          simulated: m.simulated,
          status: m.status === "stopped" ? "stopped" : "complete",
        })),
      };
    } catch (err) {
      if (err instanceof NotFoundError) {
        notFoundError = "That chat could not be found in this workspace.";
      } else {
        throw err;
      }
    }
  }

  return (
    <AthChat
      websiteName={ws.website.name}
      websiteDomain={ws.website.domain}
      connectors={connectors}
      threads={threads.map((t) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt.toISOString() }))}
      initialThread={initialThread}
      initialQuery={!sp.id && sp.q ? sp.q : undefined}
      initialSearchConsole={sp.gsc !== "0"}
      notFoundError={notFoundError}
    />
  );
}
