import { z } from "zod/v4";
import { LEAF_REGISTRY } from "../registry/conditions";

export type ConditionLeaf = { type: string; [key: string]: unknown };
export type ConditionNode =
  | { all: ConditionNode[] }
  | { any: ConditionNode[] }
  | { not: ConditionNode }
  | ConditionLeaf;

/** Leaf: any object with a `type`, validated against that type's registered parameter schema. */
const leaf = z.looseObject({ type: z.string() }).superRefine((val, ctx) => {
  const spec = LEAF_REGISTRY[val.type];
  if (!spec) {
    ctx.addIssue({ code: "custom", message: `[E_UNKNOWN_LEAF] unknown condition type '${val.type}'`, path: ["type"] });
    return;
  }
  const { type: _type, ...rest } = val as Record<string, unknown>;
  const r = spec.fields.safeParse(rest);
  if (!r.success) {
    for (const issue of r.error.issues) {
      ctx.addIssue({ code: "custom", message: `[E_LEAF_PARAMS] ${val.type}: ${issue.message}`, path: issue.path });
    }
  }
});

export const conditionNode: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(conditionNode).min(1) }),
    z.strictObject({ any: z.array(conditionNode).min(1) }),
    z.strictObject({ not: conditionNode }),
    leaf,
  ]),
) as z.ZodType<ConditionNode>;

export const optionalCondition = conditionNode.nullable();

export function isGroup(n: ConditionNode): n is { all: ConditionNode[] } | { any: ConditionNode[] } | { not: ConditionNode } {
  return "all" in n || "any" in n || "not" in n;
}

/** Visit every leaf of a condition tree, with its path from the root. */
export function walkConditionLeaves(node: ConditionNode | null | undefined, visit: (leaf: ConditionLeaf, path: (string | number)[]) => void, path: (string | number)[] = []): void {
  if (!node) return;
  const n = node as any;
  if ("all" in n) (n.all as ConditionNode[]).forEach((c, i) => walkConditionLeaves(c, visit, [...path, "all", i]));
  else if ("any" in n) (n.any as ConditionNode[]).forEach((c, i) => walkConditionLeaves(c, visit, [...path, "any", i]));
  else if ("not" in n) walkConditionLeaves(n.not as ConditionNode, visit, [...path, "not"]);
  else visit(node as ConditionLeaf, path);
}
