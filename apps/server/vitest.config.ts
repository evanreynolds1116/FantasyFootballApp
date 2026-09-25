import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
