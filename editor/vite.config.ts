// Vite config for both editor modes. Local (npm run editor): the dev server's `editor-api` plugin mounts editor/api.ts as middleware under
// /api, so the validator and engine run in Node; the browser only renders. Static (npm run editor:build = vite build --mode static): a
// relative-base build into editor/dist for GitHub Pages, where client.ts runs editor/core.ts in the browser over the bundled content.
import type { IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { createApi, MAX_BODY_BYTES, requestGuard } from "./api";

const root = fileURLToPath(new URL(".", import.meta.url));
const contentDir = fileURLToPath(new URL("../content", import.meta.url));

/** EDITOR_PORT (default 5173) when another local project already uses 5173; the API's host/origin guard checks the same port. */
const rawPort = process.env.EDITOR_PORT?.trim() || "5173"; // empty = unset
if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
  throw new Error(`EDITOR_PORT must be a port number 1..65535, got '${process.env.EDITOR_PORT}'`);
}
const PORT = Number(rawPort);

class TooLarge extends Error {}

/** The request body as JSON: Buffers collected up to MAX_BODY_BYTES (TooLarge past it), decoded once. */
const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= MAX_BODY_BYTES) chunks.push(c); // past the cap the rest is drained and dropped, so the 413 can still be sent
    });
    req.on("end", () => {
      if (size > MAX_BODY_BYTES) return fail(new TooLarge(`body exceeds ${MAX_BODY_BYTES} bytes`));
      const s = Buffer.concat(chunks).toString("utf-8");
      try { ok(s ? JSON.parse(s) : undefined); } catch (e) { fail(e); }
    });
    req.on("error", fail);
  });

function editorApi(): Plugin {
  return {
    name: "editor-api",
    configureServer(server) {
      const api = createApi(contentDir);
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        const method = req.method ?? "GET";
        let out: { status: number; json: unknown };
        const denied = requestGuard(method, req.headers, PORT);
        if (denied) out = { status: denied.status, json: { error: denied.error } };
        else {
          try {
            out = api.handle(method, req.url, method === "POST" ? await readBody(req) : undefined);
          } catch (e) {
            out = e instanceof TooLarge ? { status: 413, json: { error: e.message } } : { status: 400, json: { error: `bad request body: ${(e as Error).message}` } };
          }
        }
        res.statusCode = out.status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(out.json));
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  root,
  base: mode === "static" ? "./" : "/", // relative, so the build works under https://<user>.github.io/LO-Engine/
  plugins: [react(), editorApi()],
  server: { port: PORT, strictPort: true, host: "127.0.0.1" },
  build: { outDir: "dist", emptyOutDir: true },
}));
