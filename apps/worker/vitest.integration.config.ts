import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

/** Интеграционные тесты пайплайна: реальные Postgres и Redis. */
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
