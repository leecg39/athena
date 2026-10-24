/**
 * Report Builder (Task 18): scheduled reports a team composes from chart
 * modules, built from collected AI answers only; delivered by email (when a
 * transport is configured) and Slack (per-website incoming webhook); public
 * share links and a PDF export.
 */
export * from "./catalog";
export { listScheduledReports, createScheduledReport, updateScheduledReport, deleteScheduledReport } from "./crud";
export { buildReportData } from "./data";
export { sendScheduledReportNow, dispatchDueReports, reportSummaryLines, type ReportTransport, type ReportEmail, type DeliveryResult } from "./delivery";
export { connectSlackWebhook, disconnectSlack, getSlackConnection, validSlackWebhook } from "./slack";
export { renderReportPdfBuffer } from "./pdf";
export { getPublicReportByShareId } from "./public";
