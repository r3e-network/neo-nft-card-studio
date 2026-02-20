import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@cityofzion/neon-core/lib/")) {
            const match = id.match(/node_modules\/@cityofzion\/neon-core\/lib\/([^/]+)\//);
            return match ? `neo-core-${match[1]}` : "neo-core";
          }
          if (id.includes("node_modules/@cityofzion/neon-js/lib/")) {
            const match = id.match(/node_modules\/@cityofzion\/neon-js\/lib\/([^/]+)\//);
            return match ? `neo-js-${match[1]}` : "neo-js";
          }
          if (id.includes("node_modules/@cityofzion/neon-js") || id.includes("node_modules/@cityofzion/neon-core")) {
            return "neo-vendor";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/axios")) {
            return "http-vendor";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_PROXY_TARGET ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
