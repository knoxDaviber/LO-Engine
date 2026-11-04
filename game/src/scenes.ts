// Scene key -> painted backdrop, floor tile art and music. Music files are optional (git-ignored, replaceable), so a missing one is silent.
import type { Stage } from "../logic/stages";
import city from "../art/city.webp";
import forest from "../art/forest.webp";
import lake from "../art/lake.webp";
import mountains from "../art/mountains.webp";
import plains from "../art/plains.webp";
import swamp from "../art/swamp.webp";
import title from "../art/title.webp";
import stone from "../art/tile-stone.webp";
import grass from "../art/tile-grass.webp";
import snow from "../art/tile-snow.webp";
import wood from "../art/tile-wood.webp";

export type Scene = Stage["scene"];
export type Track = Scene | "victory";

const files = import.meta.glob("../music/*.{wav,ogg,mp3}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
export const trackUrl = (name: string): string | undefined => Object.entries(files).find(([p]) => p.replace(/^.*\/|\.\w+$/g, "") === name)?.[1];

export const SCENES: Record<Scene, { bg: string; tile: string; music: string }> = {
  plains: { bg: plains, tile: grass, music: "plains" },
  swamp: { bg: swamp, tile: wood, music: "swamp" },
  city: { bg: city, tile: stone, music: "city2" },
  forest: { bg: forest, tile: grass, music: "forest" },
  mountains: { bg: mountains, tile: snow, music: "mountain" },
  lake: { bg: lake, tile: wood, music: "plains" },
  title: { bg: title, tile: wood, music: "title" },
};

/** Style for a field element: sets --tile for the slot art. */
export const tileStyle = (scene: Scene) => ({ ["--tile" as string]: `url(${SCENES[scene].tile})` });
