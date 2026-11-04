// The content pack, built once from the YAML bundled at build time. GAME_TITLE is a working title: change it here (and in index.html's <title>).
import { bootPack } from "../logic/content";

export const GAME_TITLE = "Vanguard Tactics";

const PREFIX = "../../content/";
const bundled = import.meta.glob("../../content/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
export const pack = bootPack(Object.fromEntries(Object.entries(bundled).map(([k, v]) => [k.slice(PREFIX.length), v])));
