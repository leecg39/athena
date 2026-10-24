import { getTranslations } from "@/lib/i18n/server";
import { renderPublicReportView } from "@/components/public-report-view";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const tt = await getTranslations();
  return { title: tt("Content Proposal Report") };
}

export default async function PublicContentReportPage(props: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await props.params;
  return renderPublicReportView(shareId, true);
}
