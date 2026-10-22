import { renderPublicReportView } from "@/components/public-report-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Search & Content Report" };

export default async function PublicReportPage(props: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await props.params;
  return renderPublicReportView(shareId, false);
}
