import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod/v4";
import { characterSchema, equipmentSchema, factionSchema, rosterSchema, rulesSchema, skillSchema, soldierSchema, statusSchema } from "./schema";

const out = "schemas";
mkdirSync(out, { recursive: true });
const all = { character: characterSchema, skill: skillSchema, equipment: equipmentSchema, status: statusSchema, soldier: soldierSchema, faction: factionSchema, rules: rulesSchema, roster: rosterSchema };
for (const [name, schema] of Object.entries(all)) {
  try {
    writeFileSync(`${out}/${name}.schema.json`, JSON.stringify(z.toJSONSchema(schema as z.ZodType, { unrepresentable: "any" }), null, 2));
    console.log(`wrote ${out}/${name}.schema.json`);
  } catch (e) {
    console.error(`could not export ${name}: ${(e as Error).message}`);
  }
}
