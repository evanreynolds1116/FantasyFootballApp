import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    hookTimeout: 20_000,
    testTimeout: 20_000,
    // Each test file builds its own server (and Postgres connection pool).
    // Supabase's session-mode pooler caps total concurrent connections, so
    // test files must run one at a time rather than racing for connections.
    fileParallelism: false,
  },
});
