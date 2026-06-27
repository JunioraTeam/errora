import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["__tests__/**/*.{test,spec}.{ts,tsx}"],
    // Inline next-intl so the next/navigation alias applies inside it.
    server: { deps: { inline: ["next-intl"] } },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // next/navigation isn't resolvable as a bare ESM subpath under vitest.
      "next/navigation": path.resolve(
        __dirname,
        "./__tests__/mocks/next-navigation.ts",
      ),
    },
  },
});
