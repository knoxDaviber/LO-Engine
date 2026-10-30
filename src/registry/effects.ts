// Effect-type registry and tier flags. Community packs may only use communitySafe types; everything else is official-only.
// Per the design: effects that revive, delay or deny actions, strip buffs, change PP, or hit the whole field stay official.
export const EFFECT_REGISTRY: Record<string, { communitySafe: boolean; description: string }> = {
  damage: { communitySafe: true, description: "Deals damage" },
  heal: { communitySafe: true, description: "Heals" },
  apply_status: { communitySafe: true, description: "Applies a status (status flags and field scope are tiered separately)" },
  modify_stat: { communitySafe: true, description: "Changes a stat" },
  reduce_damage: { communitySafe: true, description: "Reduces incoming damage" },
  remove_buffs: { communitySafe: false, description: "Strips buffs" },
  modify_pp: { communitySafe: false, description: "Changes PP" },
  delay_action: { communitySafe: false, description: "Delays an action" },
  advance_action: { communitySafe: false, description: "Advances an action" },
};

/** Status flags that deny actions or bypass death are official-only. Each predicate reports whether the flag is in use. */
export const OFFICIAL_ONLY_STATUS_FLAGS: Record<string, (flags: Record<string, any>) => boolean> = {
  intercepts_death: (f) => f.intercepts_death?.enabled === true,
  prevents_action: (f) => f.prevents_action === true,
  delays_pending_action: (f) => f.delays_pending_action === true,
  ignores_tactics: (f) => f.ignores_tactics === true,
  overrides_targeting: (f) => f.overrides_targeting != null,
};
