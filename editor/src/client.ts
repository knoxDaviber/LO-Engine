// Fetch helpers for the editor API (editor/api.ts, mounted by the Vite plugin).
import type { ApiIssue } from "../apiTypes";

export class RequestError extends Error {
  constructor(message: string, public issues: ApiIssue[] = [], public status = 0) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
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
