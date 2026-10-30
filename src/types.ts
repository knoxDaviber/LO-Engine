export type Severity = "error" | "warning" | "info";

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  file?: string;
  id?: string;
  path?: string;
}

export interface Location {
  file?: string;
  id?: string;
  path?: string;
}

export class Collector {
  issues: Issue[] = [];
  add(severity: Severity, code: string, message: string, loc: Location = {}): void {
    this.issues.push({ severity, code, message, ...loc });
  }
  error(code: string, message: string, loc: Location = {}): void {
    this.add("error", code, message, loc);
  }
  warn(code: string, message: string, loc: Location = {}): void {
    this.add("warning", code, message, loc);
  }
  info(code: string, message: string, loc: Location = {}): void {
    this.add("info", code, message, loc);
  }
}

export interface Report {
  issues: Issue[];
  errors: number;
  warnings: number;
  infos: number;
  ok: boolean;
}

export function toReport(c: Collector): Report {
  const errors = c.issues.filter((i) => i.severity === "error").length;
  const warnings = c.issues.filter((i) => i.severity === "warning").length;
  const infos = c.issues.filter((i) => i.severity === "info").length;
  return { issues: c.issues, errors, warnings, infos, ok: errors === 0 };
}

export type Tier = "official" | "community";
