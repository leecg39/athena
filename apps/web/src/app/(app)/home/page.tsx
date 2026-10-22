import { requireWorkspace } from "@/lib/workspace";
import { AthAskHome } from "@/components/ask-home";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const ws = await requireWorkspace();
  return <AthAskHome firstName={ws.user.name?.split(" ")[0] ?? "there"} websiteName={ws.website.name} />;
}
