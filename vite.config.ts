import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes("node_modules/pdfjs-dist")
            ? "pdf-engine"
            : id.includes("node_modules/react") ||
                id.includes("node_modules/lucide-react")
              ? "interface"
              : undefined,
      },
    },
  },
});
