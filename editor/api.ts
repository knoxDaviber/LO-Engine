// The editor's JSON API in Node, run by the Vite dev server (editor/vite.config.ts) and directly by test/editor.api.test.ts: editor/core.ts
// over the content/ folder on disk. The server is authoritative in this mode: the browser never runs the validator or the engine. The content
// pack is loaded once per API instance (restart the editor after editing content/*.yaml); battle and roster file lists are read fresh on every
// request.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync, type Stats } from "node:fs";
import { join, resolve, sep } from "node:path";
import { readContentTexts } from "../src/load";
import { ApiError, createCore, type ContentStore } from "./core";

export { ApiError, checkPath } from "./core";

export const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * CSRF / DNS-rebinding guard for the dev server: the Host must be 127.0.0.1 or localhost on the editor's port, an Origin (when sent) must be
 * that same host, and a POST must be application/json (a cross-site form cannot send that without a preflight). Null = allowed.
 */
export function requestGuard(method: string, headers: Record<string, string | string[] | undefined>, port: number): { status: number; error: string } | null {
  const one = (k: string) => { const v = headers[k]; return Array.isArray(v) ? v[0] : v; };
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const host = one("host");
  if (!host || !hosts.includes(host)) return { status: 403, error: `host '${host ?? ""}' is not allowed` };
  const origin = one("origin");
  if (origin !== undefined && !hosts.some((h) => origin === `http://${h}`)) return { status: 403, error: `origin '${origin}' is not allowed` };
  if (method === "POST" && !(one("content-type") ?? "").toLowerCase().startsWith("application/json")) return { status: 415, error: "POST bodies must be application/json" };
  return null;
}

export function createApi(contentDir = "content") {
  const dir = resolve(contentDir);

  /** The leaf's own lstat (a symlink is not followed), or undefined when nothing is there. */
  const lstat = (full: string): Stats | undefined => {
    try {
      return lstatSync(full);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  };

  /**
   * Checks `rel` before a read or write and returns what is there (undefined = nothing). The folder must exist inside content/ (symlinks
   * resolved); the leaf must not be a symlink (dangling or not: writeFileSync would follow it) and, when present, must be a regular file.
   * Messages name only the relative path.
   */
  function check(rel: string): Stats | undefined {
    const name = rel.split("/")[0]!;
    const folderPath = join(dir, name);
    if (!existsSync(folderPath)) throw new ApiError(404, `content/${name} does not exist`);
    const folder = realpathSync(folderPath);
    if (!folder.startsWith(realpathSync(dir) + sep)) throw new ApiError(400, `${rel} resolves outside content/${name}`);
    const st = lstat(join(dir, rel));
    if (st?.isSymbolicLink()) throw new ApiError(400, `${rel} is a symlink; the editor only reads and writes plain files in content/${name}`);
    if (st && !st.isFile()) throw new ApiError(400, `${rel} is not a file`);
    return st;
  }

  /** Runs a filesystem step; an unexpected error (not an ApiError) becomes a 500 naming only `rel` and the error code, never an absolute path. */
  const fsStep = <T>(rel: string, fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(500, `${rel}: file system error ${(e as NodeJS.ErrnoException).code ?? ""}`.trim());
    }
  };

  const store: ContentStore = {
    list(folder) {
      const d = join(dir, folder);
      if (!existsSync(d)) return [];
      return readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".yaml")).map((e) => `${folder}/${e.name}`).sort();
    },
    read: (rel) => fsStep(rel, () => (check(rel) ? readFileSync(join(dir, rel), "utf-8") : undefined)), // checked before reading: a parse error would echo the file's text
    write: (rel, text, overwrite) => fsStep(rel, () => {
      const existing = check(rel);
      if (existing && !overwrite) throw new ApiError(409, `${rel} already exists`);
      try {
        writeFileSync(join(dir, rel), text, { flag: existing ? "w" : "wx" }); // wx: never follow or replace something created since the check
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ApiError(409, `${rel} already exists`);
        throw e;
      }
    }),
  };

  return createCore(readContentTexts(dir), store);
}
export type Api = ReturnType<typeof createApi>;
