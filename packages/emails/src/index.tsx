import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * Sanitize external URLs used in email CTA buttons so `javascript:` / `data:` schemes
 * can never be injected into outgoing HTML emails.
 */
export function safeEmailHref(rawUrl: string, fallback = "https://athenum.ai"): string {
  try {
    const parsed = new URL(String(rawUrl ?? "").trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function escapeEmailHtml(value: string): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch] ?? ch,
  );
}

export type EmailTemplateId =
  | "weekly_report"
  | "workspace_invite"
  | "welcome_onboarding"
  | "oracle_alert"
  | "billing_receipt";

export interface EmailTemplateDescriptor {
  id: EmailTemplateId;
  name: string;
  category: "Analytics" | "Team & RBAC" | "Onboarding" | "Brand Safety" | "Billing";
  subjectTemplate: string;
  description: string;
}

export const EMAIL_TEMPLATE_CATALOG: EmailTemplateDescriptor[] = [
  {
    id: "weekly_report",
    name: "Weekly AI Search Visibility Report",
    category: "Analytics",
    subjectTemplate: "{{brandName}} — Weekly AI Search Digest ({{weekOf}})",
    description: "Scheduled weekly digest with Mention Rate, Citation Rate, Share of Voice, and top citing domain.",
  },
  {
    id: "workspace_invite",
    name: "Workspace Team Invitation",
    category: "Team & RBAC",
    subjectTemplate: "You've been invited to join {{orgName}} on Athenum",
    description: "Transactional RBAC invitation email with role badge and one-time acceptance link.",
  },
  {
    id: "welcome_onboarding",
    name: "Welcome & AI Prompt Tracking Kickoff",
    category: "Onboarding",
    subjectTemplate: "Welcome to Athenum — {{brandName}} is now tracking AI search",
    description: "Sent after workspace provisioning with initial tracked prompt count and quickstart checklist.",
  },
  {
    id: "oracle_alert",
    name: "Oracle Brand Accuracy & Hallucination Alert",
    category: "Brand Safety",
    subjectTemplate: "[Oracle Alert] New AI inaccuracy detected for {{brandName}}",
    description: "Real-time alert when an LLM answer contradicts canonical Knowledge Base facts.",
  },
  {
    id: "billing_receipt",
    name: "Stripe Plan & Credit Pack Receipt",
    category: "Billing",
    subjectTemplate: "Athenum Receipt — {{planOrPackName}} ({{amountFormatted}})",
    description: "Tax invoice and credit ledger confirmation upon subscription renewal or credit pack purchase.",
  },
];

export function WeeklyReportEmail(props: {
  brandName: string;
  weekOf: string;
  mentionRate: number;
  citationRate: number;
  shareOfVoice: number;
  topSource?: string;
  reportUrl: string;
}) {
  const href = safeEmailHref(props.reportUrl);
  return (
    <Html>
      <Head />
      <Preview>{`${props.brandName} weekly AI search report`}</Preview>
      <Body style={{ fontFamily: "Geist, Helvetica, Arial, sans-serif", background: "#f7f7fb", padding: 24 }}>
        <Container style={{ background: "#ffffff", borderRadius: 12, padding: 24, maxWidth: 560 }}>
          <Heading style={{ color: "#4f39f6" }}>{props.brandName} — AI Search Weekly</Heading>
          <Text style={{ color: "#555" }}>Week of {props.weekOf}</Text>
          <Section style={{ display: "flex", gap: 12 }}>
            <MetricCard label="Mention rate" value={`${props.mentionRate.toFixed(1)}%`} />
            <MetricCard label="Citation rate" value={`${props.citationRate.toFixed(1)}%`} />
            <MetricCard label="Share of voice" value={`${props.shareOfVoice.toFixed(1)}%`} />
          </Section>
          {props.topSource ? (
            <Text style={{ color: "#555" }}>
              Top citing source this week: <strong>{props.topSource}</strong>
            </Text>
          ) : null}
          <Button
            href={href}
            style={{
              background: "#4f39f6",
              color: "#fff",
              borderRadius: 8,
              padding: "10px 18px",
              textDecoration: "none",
            }}
          >
            Open full report
          </Button>
          <Hr style={{ borderColor: "#eee" }} />
          <Text style={{ color: "#999", fontSize: 12 }}>
            You are receiving this because of a scheduled report in your workspace settings.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function MetricCard(props: { label: string; value: string }) {
  return (
    <Section style={{ background: "#f4f3ff", borderRadius: 8, padding: "10px 14px", flex: 1 }}>
      <Text style={{ margin: 0, color: "#666", fontSize: 12 }}>{props.label}</Text>
      <Text style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#111" }}>{props.value}</Text>
    </Section>
  );
}

export function InviteEmail(props: { orgName: string; inviteUrl: string; role: string }) {
  const href = safeEmailHref(props.inviteUrl);
  return (
    <Html>
      <Head />
      <Preview>{`You've been invited to ${props.orgName}`}</Preview>
      <Body style={{ fontFamily: "Geist, Helvetica, Arial, sans-serif", background: "#f7f7fb", padding: 24 }}>
        <Container style={{ background: "#ffffff", borderRadius: 12, padding: 24, maxWidth: 560 }}>
          <Heading style={{ color: "#111" }}>Join {props.orgName}</Heading>
          <Text>
            You&apos;ve been invited as <strong>{props.role}</strong>.
          </Text>
          <Button
            href={href}
            style={{
              background: "#4f39f6",
              color: "#fff",
              borderRadius: 8,
              padding: "10px 18px",
              textDecoration: "none",
            }}
          >
            Accept invitation
          </Button>
        </Container>
      </Body>
    </Html>
  );
}

export function WelcomeOnboardingEmail(props: {
  brandName: string;
  domain: string;
  trackedPromptsCount: number;
  dashboardUrl: string;
}) {
  const href = safeEmailHref(props.dashboardUrl);
  return (
    <Html>
      <Head />
      <Preview>{`${props.brandName} is now live on Athenum AI Search Intelligence`}</Preview>
      <Body style={{ fontFamily: "Geist, Helvetica, Arial, sans-serif", background: "#f7f7fb", padding: 24 }}>
        <Container style={{ background: "#ffffff", borderRadius: 12, padding: 24, maxWidth: 560 }}>
          <Heading style={{ color: "#4f39f6" }}>Welcome to Athenum, {props.brandName}</Heading>
          <Text style={{ color: "#444" }}>
            Your workspace for <strong>{props.domain}</strong> is configured and actively monitoring{" "}
            <strong>{props.trackedPromptsCount}</strong> high-intent AI search prompts across ChatGPT, Perplexity,
            Claude, Gemini, and Google AI Overviews.
          </Text>
          <Button
            href={href}
            style={{
              background: "#4f39f6",
              color: "#fff",
              borderRadius: 8,
              padding: "10px 18px",
              textDecoration: "none",
            }}
          >
            Launch Olympus Dashboard
          </Button>
        </Container>
      </Body>
    </Html>
  );
}

export function OracleAlertEmail(props: {
  brandName: string;
  modelName: string;
  classification: string;
  claimText: string;
  canonicalFact: string;
  oracleUrl: string;
}) {
  const href = safeEmailHref(props.oracleUrl);
  return (
    <Html>
      <Head />
      <Preview>{`Oracle detected a brand inaccuracy for ${props.brandName} on ${props.modelName}`}</Preview>
      <Body style={{ fontFamily: "Geist, Helvetica, Arial, sans-serif", background: "#f7f7fb", padding: 24 }}>
        <Container style={{ background: "#ffffff", borderRadius: 12, padding: 24, maxWidth: 560 }}>
          <Heading style={{ color: "#dc2626" }}>Oracle Brand Accuracy Alert</Heading>
          <Text style={{ color: "#444" }}>
            Model <strong>{props.modelName}</strong> produced a response classified as{" "}
            <strong>{props.classification}</strong> for {props.brandName}:
          </Text>
          <Section style={{ background: "#fef2f2", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <Text style={{ margin: 0, color: "#991b1b", fontSize: 13 }}>
              <strong>Observed Claim:</strong> {props.claimText}
            </Text>
          </Section>
          <Section style={{ background: "#f0fdf4", borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <Text style={{ margin: 0, color: "#166534", fontSize: 13 }}>
              <strong>Canonical KB Fact:</strong> {props.canonicalFact}
            </Text>
          </Section>
          <Button
            href={href}
            style={{
              background: "#dc2626",
              color: "#fff",
              borderRadius: 8,
              padding: "10px 18px",
              textDecoration: "none",
            }}
          >
            Resolve in Oracle
          </Button>
        </Container>
      </Body>
    </Html>
  );
}

export function BillingReceiptEmail(props: {
  orgName: string;
  description: string;
  amountFormatted: string;
  creditsAdded: number;
  newBalance: number;
  invoicePdfUrl: string;
}) {
  const href = safeEmailHref(props.invoicePdfUrl);
  return (
    <Html>
      <Head />
      <Preview>{`Receipt for ${props.orgName}: ${props.description} (${props.amountFormatted})`}</Preview>
      <Body style={{ fontFamily: "Geist, Helvetica, Arial, sans-serif", background: "#f7f7fb", padding: 24 }}>
        <Container style={{ background: "#ffffff", borderRadius: 12, padding: 24, maxWidth: 560 }}>
          <Heading style={{ color: "#111" }}>Payment & Credit Receipt</Heading>
          <Text style={{ color: "#444" }}>
            Thank you, <strong>{props.orgName}</strong>. Your payment of <strong>{props.amountFormatted}</strong> for{" "}
            <strong>{props.description}</strong> has been processed.
          </Text>
          <Section style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <MetricCard label="Credits Granted" value={`+${props.creditsAdded.toLocaleString()}`} />
            <MetricCard label="Updated Org Balance" value={props.newBalance.toLocaleString()} />
          </Section>
          <Button
            href={href}
            style={{
              background: "#4f39f6",
              color: "#fff",
              borderRadius: 8,
              padding: "10px 18px",
              textDecoration: "none",
            }}
          >
            Download Tax Invoice PDF
          </Button>
        </Container>
      </Body>
    </Html>
  );
}

/**
 * Deterministic, zero-DOM-overhead HTML email generator for server actions & live preview.
 */
export function renderEmailTemplateHtml(
  templateId: EmailTemplateId,
  ctx: {
    brandName?: string;
    orgName?: string;
    domain?: string;
    baseUrl?: string;
  } = {},
): { subject: string; html: string } {
  const brand = escapeEmailHtml(ctx.brandName || "Canvasly");
  const org = escapeEmailHtml(ctx.orgName || "Canvasly Org");
  const domain = escapeEmailHtml(ctx.domain || "canvasly.io");
  const base = safeEmailHref(ctx.baseUrl || "http://localhost:3000", "http://localhost:3000").replace(/\/$/, "");

  switch (templateId) {
    case "weekly_report":
      return {
        subject: `${brand} — Weekly AI Search Digest (2026-10-23)`,
        html: `<div style="font-family:Geist,Helvetica,Arial,sans-serif;background:#f7f7fb;padding:24px"><div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;margin:0 auto;border:1px solid #eef0f6"><h2 style="color:#4f39f6;margin:0 0 8px">${brand} — AI Search Weekly</h2><p style="color:#555;margin:0 0 16px;font-size:13px">Week of 2026-10-23 · Automated Executive Digest</p><div style="display:flex;gap:12px;margin-bottom:16px"><div style="background:#f4f3ff;border-radius:8px;padding:10px 14px;flex:1"><div style="color:#666;font-size:11px">Mention rate</div><div style="font-size:18px;font-weight:700;color:#111">64.2%</div></div><div style="background:#f4f3ff;border-radius:8px;padding:10px 14px;flex:1"><div style="color:#666;font-size:11px">Citation rate</div><div style="font-size:18px;font-weight:700;color:#111">41.8%</div></div><div style="background:#f4f3ff;border-radius:8px;padding:10px 14px;flex:1"><div style="color:#666;font-size:11px">Share of voice</div><div style="font-size:18px;font-weight:700;color:#111">38.5%</div></div></div><p style="color:#555;font-size:13px">Top citing source this week: <strong>g2.com</strong></p><a href="${base}/olympus" style="display:inline-block;background:#4f39f6;color:#fff;border-radius:8px;padding:10px 18px;text-decoration:none;font-size:13px;font-weight:600">Open full report</a></div></div>`,
      };
    case "workspace_invite":
      return {
        subject: `You've been invited to join ${org} on Athenum`,
        html: `<div style="font-family:Geist,Helvetica,Arial,sans-serif;background:#f7f7fb;padding:24px"><div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;margin:0 auto;border:1px solid #eef0f6"><h2 style="color:#111;margin:0 0 8px">Join ${org}</h2><p style="color:#444;font-size:13px">You have been invited as <strong>Admin</strong> to collaborate on AI search visibility for <strong>${brand}</strong> (${domain}).</p><a href="${base}/settings/users" style="display:inline-block;background:#4f39f6;color:#fff;border-radius:8px;padding:10px 18px;text-decoration:none;font-size:13px;font-weight:600">Accept invitation</a></div></div>`,
      };
    case "welcome_onboarding":
      return {
        subject: `Welcome to Athenum — ${brand} is now tracking AI search`,
        html: `<div style="font-family:Geist,Helvetica,Arial,sans-serif;background:#f7f7fb;padding:24px"><div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;margin:0 auto;border:1px solid #eef0f6"><h2 style="color:#4f39f6;margin:0 0 8px">Welcome to Athenum, ${brand}</h2><p style="color:#444;font-size:13px">Your workspace for <strong>${domain}</strong> is live and tracking high-intent prompts across ChatGPT, Perplexity, Claude, Gemini, and AI Overviews.</p><a href="${base}/home" style="display:inline-block;background:#4f39f6;color:#fff;border-radius:8px;padding:10px 18px;text-decoration:none;font-size:13px;font-weight:600">Launch Olympus Dashboard</a></div></div>`,
      };
    case "oracle_alert":
      return {
        subject: `[Oracle Alert] New AI inaccuracy detected for ${brand}`,
        html: `<div style="font-family:Geist,Helvetica,Arial,sans-serif;background:#f7f7fb;padding:24px"><div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;margin:0 auto;border:1px solid #eef0f6"><h2 style="color:#dc2626;margin:0 0 8px">Oracle Brand Accuracy Alert</h2><p style="color:#444;font-size:13px">Model <strong>gpt-4o</strong> produced a response classified as <strong>Confirmed Inaccuracy</strong> for ${brand}:</p><div style="background:#fef2f2;border-radius:8px;padding:12px;margin-bottom:10px;color:#991b1b;font-size:12px"><strong>Observed Claim:</strong> ${brand} does not support SAML SSO or SCIM provisioning.</div><div style="background:#f0fdf4;border-radius:8px;padding:12px;margin-bottom:16px;color:#166534;font-size:12px"><strong>Canonical KB Fact:</strong> ${brand} supports SAML 2.0 SSO, OIDC, and automated SCIM 2.0 directory sync.</div><a href="${base}/oracle" style="display:inline-block;background:#dc2626;color:#fff;border-radius:8px;padding:10px 18px;text-decoration:none;font-size:13px;font-weight:600">Resolve in Oracle</a></div></div>`,
      };
    case "billing_receipt":
      return {
        subject: `Athenum Receipt — Starter Plan & Credit Allocation ($295.00)`,
        html: `<div style="font-family:Geist,Helvetica,Arial,sans-serif;background:#f7f7fb;padding:24px"><div style="background:#fff;border-radius:12px;padding:24px;max-width:560px;margin:0 auto;border:1px solid #eef0f6"><h2 style="color:#111;margin:0 0 8px">Payment & Credit Receipt</h2><p style="color:#444;font-size:13px">Thank you, <strong>${org}</strong>. Your payment of <strong>$295.00</strong> for <strong>Athenum Starter Plan (Monthly)</strong> has been processed.</p><div style="display:flex;gap:12px;margin-bottom:16px"><div style="background:#f4f3ff;border-radius:8px;padding:10px 14px;flex:1"><div style="color:#666;font-size:11px">Credits Granted</div><div style="font-size:18px;font-weight:700;color:#111">+3,600</div></div><div style="background:#f4f3ff;border-radius:8px;padding:10px 14px;flex:1"><div style="color:#666;font-size:11px">Org Pool Status</div><div style="font-size:18px;font-weight:700;color:#111">Active</div></div></div><a href="${base}/settings/billing" style="display:inline-block;background:#4f39f6;color:#fff;border-radius:8px;padding:10px 18px;text-decoration:none;font-size:13px;font-weight:600">View Billing & Invoices</a></div></div>`,
      };
  }
}
