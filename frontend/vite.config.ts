import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The app always calls /api on its own origin. In production the backend serves the build
// and the API together. In dev, proxy /api to a running backend (set in .env.local).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.DEV_API_PROXY || "http://localhost:8787";
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": { target, changeOrigin: true, secure: true },
      },
    },
  };
});
