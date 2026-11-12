import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

// Preview build: the real panel code against a small mock of the OpenCode host.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [solid()],
  resolve: {
    alias: {
      "@opencode/plugin/gui": fileURLToPath(new URL("./mock-gui.tsx", import.meta.url)),
      "@opencode/client/solid": fileURLToPath(new URL("./mock-client-solid.ts", import.meta.url)),
    },
  },
  build: { outDir: fileURLToPath(new URL("./dist", import.meta.url)), emptyOutDir: true, modulePreload: false },
})
