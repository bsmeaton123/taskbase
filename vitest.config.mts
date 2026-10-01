import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Lets tests import server modules for their pure helpers.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // The Postgres client connects lazily; unit tests never query it.
    env: { DATABASE_URL: "postgres://test:test@127.0.0.1:1/test" },
  },
});
