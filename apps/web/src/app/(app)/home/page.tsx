import { getTranslations } from "@/lib/i18n/server";
import { db } from "@athena/db";
import { listThreads } from "@athena/core/assistant";
import { requireWorkspace } from "@/lib/workspace";
import { connectorsFor } from "@/lib/assistant";
import { AthAskHome } from "@/components/ask-home";

export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Home") };
}

export default async function HomePage() {
  const ws = await requireWorkspace();
  const [connectors, threads] = await Promise.all([
    connectorsFor(ws),
    listThreads(db, { actorId: ws.user.id, websiteId: ws.websiteId, limit: 8 }),
  ]);

  return (
    <AthAskHome
      firstName={ws.user.name?.split(" ")[0] ?? ""}
      websiteName={ws.website.name}
      connectors={connectors}
      recentThreads={threads.map((t) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt.toISOString() }))}
    />
  );
}
