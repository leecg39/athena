import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";

export default async function RootPage() {
  const user = await getUser();
  redirect(user ? "/home" : "/login?redirect=%2Fhome");
}
