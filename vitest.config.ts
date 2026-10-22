import { defineConfig } from "vitest/config";

/** Each workspace with tests has its own vitest.config.ts (aliases, timeouts). */
export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts", "apps/web/vitest.config.ts"],
  },
});
