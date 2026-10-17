import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/.claude/**", "**/node_modules/**", "**/dist/**", "**/.next/**"],
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
});
