// The main game client (Decision 137). Static: the engine runs in the browser over the bundled content. Sprites are shared with the editor.
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  publicDir: fileURLToPath(new URL("../editor/public", import.meta.url)),
  plugins: [react()],
  server: { port: Number(process.env.GAME_PORT || 5174), strictPort: true, host: "127.0.0.1" },
  build: { outDir: "dist", emptyOutDir: true },
});
