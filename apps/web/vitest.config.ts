import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts") } },
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], testTimeout: 60_000, hookTimeout: 120_000 },
});
