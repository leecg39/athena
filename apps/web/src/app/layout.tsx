import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PostHogProvider } from "@/components/posthog-provider";
import { LocaleProvider } from "@/components/locale-provider";
import { getLocale } from "@/lib/i18n/server";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const tt = await getTranslations();
  return {
  title: { default: "Athenum", template: "%s | Athenum" },
  description: tt("Agents to win on AI search — track, understand and act on your AI search presence."),
  manifest: "/manifest.webmanifest",
};
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans">
        <LocaleProvider locale={locale}><PostHogProvider>{children}</PostHogProvider></LocaleProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
