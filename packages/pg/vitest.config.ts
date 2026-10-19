import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], exclude: ["**/node_modules/**"], testTimeout: 20_000, fileParallelism: false },
});
