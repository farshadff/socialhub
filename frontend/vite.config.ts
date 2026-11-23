/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The browser always calls the relative path /api/v1/. In development Vite
// proxies it to Django; Docker sets SOCIALHUB_API_PROXY_TARGET to the backend service.
const apiTarget = process.env.SOCIALHUB_API_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/v1/": { target: apiTarget, changeOrigin: true },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
