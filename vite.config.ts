import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  publicDir: "public",
  server: {
    port: 5190,
    // свой порт без автоподбора: на 5173–5174 бывают чужие dev-серверы, и браузер открывает не ту игру
    strictPort: true,
    host: true,
    fs: { allow: [".."] },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
