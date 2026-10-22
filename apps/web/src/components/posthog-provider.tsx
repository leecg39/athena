"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (key) {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
        capture_pageview: true,
        capture_exceptions: true,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: "[data-ph-mask]",
        },
      });
    }

    // Emit first-party pageview & session replay heartbeat to /api/telemetry
    const pagePath = typeof window !== "undefined" ? window.location.pathname : "/";
    fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "event",
        event: "$pageview",
        properties: { path: pagePath },
      }),
    }).catch(() => undefined);
  }, []);

  return <>{children}</>;
}
