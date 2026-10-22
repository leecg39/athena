import { PageHeader } from "@/components/page-header";
import { OracleList } from "@/components/oracle-list";

export const metadata = { title: "Oracle" };

export default async function OraclePage() {
  const findings = [
    {
      id: "of1",
      type: "confirmed_inaccuracy",
      claim: "Canvasly's free plan supports 50-person workspaces",
      evidence: "ChatGPT responded: 'Canvasly's free tier is limited to 10 users' — contradicts the confirmed KB fact (50 users).",
      models: ["chatgpt", "ai_overview"],
    },
    {
      id: "of2",
      type: "kb_inconsistency",
      claim: "Canvasly was founded in 2021",
      evidence: "KB contains two conflicting facts: founded 2021 (pillar: Company) vs 2020 (pillar: History).",
      models: ["perplexity"],
    },
    {
      id: "of3",
      type: "model_disagreement",
      claim: "Canvasly pricing starts at $19/mo",
      evidence: "ChatGPT says $29/mo; Grok says $15/mo; KB says $29/mo.",
      models: ["chatgpt", "grok", "perplexity"],
    },
  ];
  return (
    <div>
      <PageHeader
        title="Oracle"
        subtitle="Scan AI responses against your knowledge base — review the evidence, keep your brand facts current"
        actions={<button className="btn-primary">Run scan</button>}
      />
      <div className="p-6">
        <OracleList findings={findings} />
      </div>
    </div>
  );
}
