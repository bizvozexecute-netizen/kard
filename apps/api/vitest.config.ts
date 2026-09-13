import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC нужен, чтобы в тестах работали декораторы Nest и emitDecoratorMetadata (esbuild их не поддерживает).
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 15_000,
  },
});
