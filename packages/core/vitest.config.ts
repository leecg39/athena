import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], testTimeout: 60_000, hookTimeout: 120_000 },
});
