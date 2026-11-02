import { useEffect, useState } from "react";

// Sheets are 1024x256: 4 frames facing right. The element's background is 400% wide, so frame k sits at x = k/3 * 100% (0, 33.33, 66.67, 100).
// The animation runs background-position-x 0% -> 133.333% with steps(4): jump-end steps show 0, 1/4, 2/4, 3/4 of that range = frames 0..3,
// and the (never shown) end value is outside. Percentages make it independent of the pixel size, unlike calc(var(--s) * -4) in keyframes.

const probed = new Map<string, boolean>(); // class -> sheet loads (module-level so remounts do not flicker)

function useSheet(cls: string): boolean | undefined {
  const [res, setRes] = useState<{ cls: string; ok: boolean | undefined }>({ cls, ok: probed.get(cls) });
  const setOk = (ok: boolean) => setRes({ cls, ok });
  useEffect(() => {
    if (probed.has(cls)) { setOk(probed.get(cls)!); return; }
    let live = true;
    const img = new Image();
    img.onload = () => { probed.set(cls, true); if (live) setOk(true); };
    img.onerror = () => { probed.set(cls, false); if (live) setOk(false); };
    img.src = `/sprites/${cls}.png`;
    return () => { live = false; };
  }, [cls]);
  // A result belongs to the class it was probed for: while a new class is loading, show neither the old sheet nor the fallback.
  return res.cls === cls ? res.ok : probed.get(cls);
}

const initials = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "?") + (w.length > 1 ? w[w.length - 1]![0] : "")).toUpperCase();
};

export function Sprite({ cls, name, mirror, size = 96 }: { cls: string; name: string; mirror?: boolean; size?: number }) {
  const ok = useSheet(cls);
  const box = { width: size, height: size, transform: mirror ? "scaleX(-1)" : undefined };
  if (ok === false)
    return (
      <span className="sprite sprite-fallback" role="img" aria-label={`${name} (${cls})`} style={{ ...box, fontSize: size * 0.3 }}>
        {initials(name)}
      </span>
    );
  return (
    <span
      className={`sprite${ok ? " sprite-anim" : ""}`}
      role="img"
      aria-label={`${name} (${cls})`}
      style={{ ...box, backgroundImage: ok ? `url(/sprites/${cls}.png)` : undefined }}
    />
  );
}
