import { getUser } from "@/lib/session";
import { getWorkspace } from "@/lib/data";
import { AthAskHome } from "@/components/ask-home";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await getUser();
  const ws = await getWorkspace(user?.id);
  return <AthAskHome firstName={user?.name?.split(" ")[0] ?? "there"} websiteName={ws.websiteName} />;
}
