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

export function WeeklyReportEmail(props: {
  brandName: string;
  weekOf: string;
  mentionRate: number;
  citationRate: number;
  shareOfVoice: number;
  topSource?: string;
  reportUrl: string;
}) {
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
            <Text style={{ color: "#555" }}>Top citing source this week: <strong>{props.topSource}</strong></Text>
          ) : null}
          <Button
            href={props.reportUrl}
            style={{ background: "#4f39f6", color: "#fff", borderRadius: 8, padding: "10px 18px", textDecoration: "none" }}
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
  return (
    <Html>
      <Head />
      <Preview>{`You've been invited to ${props.orgName}`}</Preview>
      <Body style={{ fontFamily: "Geist, Helvetica, Arial, sans-serif", background: "#f7f7fb", padding: 24 }}>
        <Container style={{ background: "#ffffff", borderRadius: 12, padding: 24, maxWidth: 560 }}>
          <Heading style={{ color: "#111" }}>Join {props.orgName}</Heading>
          <Text>You've been invited as <strong>{props.role}</strong>.</Text>
          <Button
            href={props.inviteUrl}
            style={{ background: "#4f39f6", color: "#fff", borderRadius: 8, padding: "10px 18px", textDecoration: "none" }}
          >
            Accept invitation
          </Button>
        </Container>
      </Body>
    </Html>
  );
}
