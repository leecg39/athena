import { Suspense } from "react";
import { AthChat } from "@/components/ath-chat";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Ask Athena" };

export default async function ChatPage() {
  await requireUser("/chat");
  return (
    <Suspense>
      <AthChat />
    </Suspense>
  );
}
