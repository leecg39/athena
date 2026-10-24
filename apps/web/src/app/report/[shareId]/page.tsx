import { getTranslations } from "@/lib/i18n/server";
import { renderPublicReportView } from "@/components/public-report-view";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("AI Search & Content Report") };
}

export default async function PublicReportPage(props: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await props.params;
  return renderPublicReportView(shareId, false);
}
