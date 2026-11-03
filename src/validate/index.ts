import { loadPack } from "../load";
import type { Report } from "../types";
import type { Pack } from "./pack";
import { validateRaw, type ValidateOptions } from "./raw";

export { validateRaw, type ValidateOptions } from "./raw";

/** Reads a content directory and validates it (validateRaw). */
export function validateContent(dir: string, opts: ValidateOptions = {}): { report: Report; pack: Pack | null } {
  return validateRaw(loadPack(dir), opts);
}
