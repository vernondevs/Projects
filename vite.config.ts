import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  publicDir: "public",
  server: {
    port: 5173,
    host: true,
    fs: { allow: [".."] },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
