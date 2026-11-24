/**
 * Vite 配置：root=src/ui，产物到 src/ui/dist（Electron 用 loadFile 打开）。
 * base:'./' 必须保留 —— Electron 下是 file:// 协议，绝对路径 /assets 会 404。
 */
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [vue()],
  build: {
    outDir: "../../build",
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ["monaco-editor"],
          vendor: ["vue", "element-plus"],
        },
      },
    },
  },
  server: {
    port: 5178,
    strictPort: true,
    hmr: { host: "localhost" }, // 明确 HMR WebSocket 地址，避免 Electron 内网 IP 解析问题
    watch: {
        ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**']
    },
  },
});
