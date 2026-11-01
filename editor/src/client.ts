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
  const json = await res.json();
  if (!res.ok) throw new RequestError(json.error ?? res.statusText, json.issues ?? [], res.status);
  return json as T;
}

export const get = <T>(url: string) => call<T>("GET", url);
export const post = <T>(url: string, body: unknown) => call<T>("POST", url, body);
