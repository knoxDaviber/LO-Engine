// Request helpers for the editor API. Local editor (npm run editor): fetch against editor/api.ts, mounted by the Vite plugin. Static build
// (vite build --mode static, GitHub Pages): the same requests go in-process to editor/core.ts (staticApi.ts), with the same response shapes
// and error statuses.
import type { ApiIssue } from "../apiTypes";
import type { Core } from "../core";

/** True in the static (hosted) build: content is bundled read-only and save downloads the file. */
export const HOSTED = import.meta.env.MODE === "static";

export class RequestError extends Error {
  constructor(message: string, public issues: ApiIssue[] = [], public status = 0) {
    super(message);
  }
}

let core: Promise<Core> | undefined;

/** The static build's in-process call. Body and result go through JSON like a real request, so nothing is shared with the UI's state. */
async function local<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const api = await (core ??= import("./staticApi").then((m) => m.core));
  const out = api.handle(method, url, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
  const json: any = out.json === undefined ? null : JSON.parse(JSON.stringify(out.json));
  if (out.status >= 400) throw new RequestError(json?.error ?? `request failed (${out.status})`, json?.issues ?? [], out.status);
  return json as T;
}

async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  if (HOSTED) return local<T>(method, url, body);
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON (proxy / crash page) */ }
  if (!res.ok) throw new RequestError(json?.error ?? (res.statusText || `request failed (${res.status})`), json?.issues ?? [], res.status);
  if (json === null) throw new RequestError(`${res.statusText || "empty or non-JSON response"} (${res.status})`, [], res.status);
  return json as T;
}

export const get = <T>(url: string) => call<T>("GET", url);
export const post = <T>(url: string, body: unknown) => call<T>("POST", url, body);
