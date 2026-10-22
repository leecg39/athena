import { renderPublicReportView } from "@/components/public-report-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Content Proposal Report" };

export default async function PublicContentReportPage(props: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await props.params;
  return renderPublicReportView(shareId, true);
}
