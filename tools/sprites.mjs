// sprites.mjs: art/raw/<class>.png (designer's AI sprite sheets, one row of 4 idle frames) ->
// editor/public/sprites/<class>.png (4 cells of CELL x CELL, transparent, facing right, feet anchored) + art/preview.png.
//
//   npm run sprites                 all classes
//   npm run sprites -- mage holy    only these
//   SPRITES_DEBUG=<dir> node tools/sprites.mjs holy   also writes <dir>/<cls>_enclosed.png (enclosed regions:
//                                   green removed, red kept) and logs the regions and specks
//
// Per sheet: checker sheets get border flood + enclosed checker gaps removed (clean-art removeBg), the glow and the
// ground shadow painted over the checker rebuilt as translucent pixels; RGBA sheets are only defringed. Then: split
// into 4 frames at empty columns, drop specks, anchor each frame at the bottom centre of its ground shadow (feet band
// matched to frame 1), one scale per class, box-filter downscale (clean-art downscale) into the cells.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { load, save, removeBg, defringe, flipX, downscale, boxBlur } from './clean-art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'art/raw'), OUT = path.join(ROOT, 'editor/public/sprites');
const CLASSES = ['infantry', 'lancer', 'cavalry', 'archer', 'flyer', 'mage', 'assassin', 'holy', 'aquatic', 'monster']; // src/schema/enums.ts order
const CELL = 256, FRAMES = 4, MARGIN = 4;   // MARGIN: px kept free below the anchor, above the top and at the sides
const HUMANOID_H = 232;                     // target height (px) of a frame's tallest point above the anchor
const SPECK = 12, SLIVER = 2000;            // dropSpecks: noise / neighbour-frame sliver size limits (source px)
const GLOW_SAT = 110;                       // glowToAlpha: tint (max-min channel) that counts as fully opaque glow
const SHADOW = [24, 26, 38];                // shadowToAlpha: colour of the rebuilt translucent ground shadow
// Per-class overrides: flip = source faces left; size = multiplier on the common target (mounted units fill more).
// anchor 'match' = no ground shadow (flyer): frame 1 is centred on its box, the others placed where their silhouette
// best overlaps frame 1's (alignFrames), which drops the sheet's placement noise; the lowest frame sits on the margin.
const OPTS = { cavalry: { size: 1.1 }, flyer: { size: 1.1, anchor: 'match' } };

// ---- background (checker sheets) ----------------------------------------------------------------------------

/** The two checker tones of a fake-transparency sheet, read from the top and bottom border bands. */
function checkerTones(im) {
  const hist = new Uint32Array(256), { w, h, d } = im;
  for (const y0 of [0, h - 24]) for (let y = y0; y < y0 + 24; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4, mx = Math.max(d[p], d[p + 1], d[p + 2]), mn = Math.min(d[p], d[p + 1], d[p + 2]);
    if (mx - mn <= 8) hist[Math.round((d[p] + d[p + 1] + d[p + 2]) / 3)]++; }
  const mode = (a, b) => { let k = a; for (let v = a; v <= b; v++) if (hist[v] > hist[k]) k = v; return k; };
  const light = mode(244, 255); return { light, dark: mode(200, light - 8) };
}

/** Enclosed bg-like regions (not reached by the border flood) go when they are checker background:
 *  (a) both checker tones show (each >= 10% of the region, together >= 60%; the rest is watermark and blends), or
 *  (b) mostly one tone (>= 85%) inside a dark outline rim (a gap between outlined parts), or
 *  (c) mostly one tone (>= 60%) with a trace of the other (>= 4%, so a pure white eye highlight or tooth never
 *      qualifies) inside a darkish rim (a hole in a cape).
 *  Anything ringed by the character's own light colours (a white robe panel, its shading) stays. Only the neutral
 *  pixels of a removed region go, so a pale tinted crystal facet touching it survives. */
function enclosedChecker(tones, stats) {
  return (im, bg, like) => {
    const { w, h, d } = im, N = w * h, seen = new Uint8Array(N), tol = 7;
    const sat = p => Math.max(d[p], d[p + 1], d[p + 2]) - Math.min(d[p], d[p + 1], d[p + 2]);
    const tone = i => { const p = i * 4; if (sat(p) > 10) return 0;
      const v = (d[p] + d[p + 1] + d[p + 2]) / 3; return Math.abs(v - tones.light) <= tol ? 1 : Math.abs(v - tones.dark) <= tol ? 2 : 0; };
    for (let s = 0; s < N; s++) {
      if (bg[s] || seen[s] || !like(s)) continue;
      const px = [s], rim = new Set(); seen[s] = 1;
      for (let k = 0; k < px.length; k++) for (const j of nb4(px[k], w, N)) {
        if (j < 0 || seen[j]) continue; if (like(j) && !bg[j]) { seen[j] = 1; px.push(j); } else if (!bg[j]) rim.add(j); }
      if (px.length < 12) continue;
      let nl = 0, nd = 0; for (const i of px) { const t = tone(i); if (t === 1) nl++; else if (t === 2) nd++; }
      const rimBelow = lim => { let k = 0; for (const j of rim) { const p = j * 4; if (Math.max(d[p], d[p + 1], d[p + 2]) < lim) k++; } return k / Math.max(1, rim.size); };
      const n = px.length, hi = Math.max(nl, nd), lo = Math.min(nl, nd);
      const go = (lo >= .1 * n && nl + nd >= .6 * n)
        || (hi >= .85 * n && rimBelow(110) >= .5)
        || (hi >= .6 * n && lo >= .04 * n && rimBelow(150) >= .5);
      if (go) { for (const i of px) if (sat(i * 4) <= 12) bg[i] = 1; stats.removed++; } else if (n >= 40) stats.kept++;
      if (stats.debug && n >= 40) stats.debug.push({ px, removed: go, n, nl: +(nl / n).toFixed(2), nd: +(nd / n).toFixed(2) });
    }
  };
}

const nb4 = (i, w, N) => { const x = i % w; return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < N - w ? i + w : -1]; };

/** Transparent pixels connected to the sheet border (not enclosed gaps). */
function outerBg(im) {
  const { w, h, d } = im, N = w * h, out = new Uint8Array(N), st = [];
  const push = i => { if (!out[i] && !d[i * 4 + 3]) { out[i] = 1; st.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) for (const j of nb4(st.pop(), w, N)) if (j >= 0) push(j);
  return out;
}

/** The ground shadow was painted translucent over the checker and baked in, so it is an opaque light grey with the
 *  checker showing through. Grey pixels in the bottom band reached from the outer background become a dark shadow whose
 *  alpha is how much they darken the checker (1 - v / light tone), smoothed over a checker square so the pattern goes. */
function shadowToAlpha(im, tones) {
  const { w, h, d } = im, N = w * h, out = outerBg(im), inR = new Uint8Array(N), st = [];
  let yb = h - 1; for (; yb > 0; yb--) { let n = 0; for (let x = 0; x < w; x++) if (d[(yb * w + x) * 4 + 3] >= 128) n++; if (n >= 12) break; }
  const y0 = yb - Math.round(h * .1);
  const like = i => { const p = i * 4; if (!d[p + 3] || i < y0 * w) return false; const mx = Math.max(d[p], d[p + 1], d[p + 2]), mn = Math.min(d[p], d[p + 1], d[p + 2]); return mx - mn <= 30 && mn >= 110 && mx < tones.light - 4; };
  for (let i = 0; i < N; i++) if (like(i) && nb4(i, w, N).some(j => j >= 0 && out[j])) { inR[i] = 1; st.push(i); }
  while (st.length) for (const j of nb4(st.pop(), w, N)) if (j >= 0 && !inR[j] && like(j)) { inR[j] = 1; st.push(j); }
  const a = new Float32Array(N), m = new Float32Array(N); let n = 0;
  for (let i = 0; i < N; i++) if (inR[i]) { const p = i * 4; a[i] = Math.max(0, 1 - (d[p] + d[p + 1] + d[p + 2]) / 3 / tones.light); m[i] = 1; n++; }
  const r = Math.max(2, Math.round(h / 140)), sa = boxBlur(a, w, h, r), sm = boxBlur(m, w, h, r);
  for (let i = 0; i < N; i++) if (inR[i]) { const p = i * 4; d[p] = SHADOW[0]; d[p + 1] = SHADOW[1]; d[p + 2] = SHADOW[2]; d[p + 3] = Math.round(Math.min(1, sa[i] / sm[i]) * d[p + 3]); }
  return n;
}

/** Soft glow painted over the fake checker (holy staff, mage book) would stay an opaque pale blob: bright tinted pixels
 *  reached from the removed background without crossing an outline get alpha from their tint (saturation / GLOW_SAT)
 *  and their colour pushed toward full tint, so the glow stays a coloured haze and the checker under it fades out. */
function glowToAlpha(im) {
  const { w, h, d } = im, N = w * h, inR = new Uint8Array(N), st = [];
  const glow = i => { const p = i * 4; if (!d[p + 3]) return false; const mn = Math.min(d[p], d[p + 1], d[p + 2]); return mn >= 150 && Math.max(d[p], d[p + 1], d[p + 2]) - mn >= 25; };
  const nb = i => { const x = i % w; return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < N - w ? i + w : -1]; };
  const out = outerBg(im);
  for (let i = 0; i < N; i++) if (glow(i) && nb(i).some(j => j >= 0 && out[j])) { inR[i] = 1; st.push(i); }
  while (st.length) { const i = st.pop(), x = i % w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < N && !inR[j] && glow(j)) { inR[j] = 1; st.push(j); } }
  let n = 0;
  for (let i = 0; i < N; i++) { if (!inR[i]) continue; const p = i * 4, a = Math.min(1, (Math.max(d[p], d[p + 1], d[p + 2]) - Math.min(d[p], d[p + 1], d[p + 2])) / GLOW_SAT);
    for (let c = 0; c < 3; c++) d[p + c] = Math.max(0, Math.min(255, Math.round(255 - (255 - d[p + c]) / a)));
    d[p + 3] = Math.round(d[p + 3] * a); n++; }
  return n;
}

/** Drop noise inside frame range [a, b): pieces (pixels within 3 px are one piece) under SPECK opaque px, and slivers of
 *  the neighbouring frame cut off at the range edge (under SLIVER px and touching it). Loose effect bits (water drops,
 *  magic particles, often 30-60 px at source size) stay with their frame. */
function dropSpecks(im, [a, b]) {
  const { w, h, d } = im, N = w * h, on = new Float32Array(N); for (let i = 0; i < N; i++) { const x = i % w; on[i] = x >= a && x < b && d[i * 4 + 3] >= 24 ? 1 : 0; }
  const near = boxBlur(on, w, h, 3), lab = new Int32Array(N), dropped = [];
  for (let s = 0; s < N; s++) { if (lab[s] || !on[s]) continue; const px = [s]; lab[s] = 1; let n = 0, mn = w, mx = 0;
    for (let k = 0; k < px.length; k++) { const i = px[k], x = i % w; if (on[i]) { n++; if (x < mn) mn = x; if (x > mx) mx = x; }
      for (const j of [x > a ? i - 1 : -1, x < b - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < N && !lab[j] && near[j] > 1e-6) { lab[j] = 1; px.push(j); } }   // never leaves [a, b)
    const edge = (a > 0 && mn < a + 16) || (b < w && mx >= b - 16);   // within 16 px of a cut
    if (n < SPECK || (edge && n < SLIVER)) { for (const i of px) d[i * 4 + 3] = 0; dropped.push(`${n}@${s % w},${Math.floor(s / w)}`); } }
  return dropped;
}

// ---- frames -------------------------------------------------------------------------------------------------

/** x ranges of the 4 frames: split at runs of empty columns (no pixel with alpha >= 96) near the content quarters. */
function frameRanges(im) {
  const { w, h, d } = im, col = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] >= 96) col[x]++;   // faint glow edges may touch the next frame
  let x0 = 0, x1 = w - 1; while (x0 < w && !col[x0]) x0++; while (x1 > 0 && !col[x1]) x1--;
  if (x1 - x0 < FRAMES) throw new Error('blank sheet: no opaque pixels after background removal');
  const gaps = []; for (let x = x0; x <= x1; x++) if (!col[x]) { let e = x; while (e + 1 <= x1 && !col[e + 1]) e++; gaps.push([x, e]); x = e; }
  if (process.env.SPRITES_DEBUG) console.log('  content', x0, x1, 'gaps', gaps.map(g => g.join('-')).join(' '));
  // boundary k: the widest gap near the k-th quarter of the content, else the emptiest column there (a glow can reach
  // the next frame), so a frame never loses its own pixels to a straight quarter cut through it
  const span = x1 - x0, edges = [0], how = [];
  for (let k = 1; k < FRAMES; k++) {
    const q = x0 + k * span / FRAMES, near = gaps.filter(g => Math.abs((g[0] + g[1]) / 2 - q) < span / 8).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    if (near.length) { edges.push(Math.round((near[0][0] + near[0][1]) / 2)); how.push('gap'); continue; }
    let best = Math.round(q); for (let x = Math.round(q - span / 16); x <= q + span / 16; x++) if (col[x] < col[best]) best = x;
    edges.push(best); how.push(`min-column(${col[best]}px)`); }
  edges.push(w);
  return { split: how.join(','), ranges: edges.slice(1).map((e, k) => [edges[k], e]) };
}

/** Frame content box and anchor: bottom of the ground shadow (lowest row with a real run of opaque pixels), x = the
 *  centre of the opaque span over the bottom rows (the shadow ellipse). */
function anchorOf(im, [a, b]) {
  const { w, h, d } = im, op = (x, y) => d[(y * w + x) * 4 + 3] >= 40;   // RGBA sheets have a translucent shadow
  let top = h, low = 0, minX = b, maxX = a, bottom = -1;
  for (let y = 0; y < h; y++) for (let x = a; x < b; x++) if (d[(y * w + x) * 4 + 3] >= 24) { if (y < top) top = y; if (y > low) low = y; if (x < minX) minX = x; if (x > maxX) maxX = x; }
  for (let y = h - 1; y >= 0 && bottom < 0; y--) { let n = 0; for (let x = a; x < b; x++) if (op(x, y)) n++; if (n >= 12) bottom = y; }
  if (bottom < 0) throw new Error(`blank frame at x ${a}-${b}: no row with 12 opaque pixels (no ground shadow or feet)`);
  const band = Math.max(4, Math.round(h / 90)); let sx0 = b, sx1 = a;
  for (let y = bottom - band; y <= bottom; y++) for (let x = a; x < b; x++) if (op(x, y)) { if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; }
  return { ax: (sx0 + sx1) / 2, ay: bottom + 1, top, low, minX, maxX };
}

/** Binary silhouette (alpha >= 128) of frame f, downsampled by k (a cell is on when any pixel in it is). */
function mask(im, f, k) {
  const [a, b] = f.r, w = Math.ceil((b - a) / k), h = Math.ceil(im.h / k), m = new Uint8Array(w * h);
  for (let y = 0; y < im.h; y++) for (let x = a; x < b; x++) if (im.d[(y * im.w + x) * 4 + 3] >= 128) m[Math.floor(y / k) * w + Math.floor((x - a) / k)] = 1;
  return { w, h, m };
}
function overlap(A, B, dx, dy) {   // |A AND (B shifted by dx, dy)|
  let n = 0; for (let y = Math.max(0, dy); y < Math.min(A.h, B.h + dy); y++) for (let x = Math.max(0, dx); x < Math.min(A.w, B.w + dx); x++) n += A.m[y * A.w + x] & B.m[(y - dy) * B.w + x - dx];
  return n;
}
/** Anchor frames 2..4 at frame 1's anchor plus the shift that best overlaps their silhouettes (coarse 4x search, then 1 px). */
function alignFrames(im, fr) {
  const f0 = fr[0]; f0.ax = (f0.minX + f0.maxX + 1) / 2;   // no shadow: centre frame 1 on its box
  for (const f of fr.slice(1)) {
    let best = [0, 0], bn = -1;
    const A4 = mask(im, f0, 4), B4 = mask(im, f, 4);
    for (let dy = -30; dy <= 30; dy++) for (let dx = -40; dx <= 40; dx++) { const n = overlap(A4, B4, dx, dy); if (n > bn) { bn = n; best = [dx * 4, dy * 4]; } }
    const A = mask(im, f0, 1), B = mask(im, f, 1), c = best; bn = -1;
    for (let dy = c[1] - 4; dy <= c[1] + 4; dy++) for (let dx = c[0] - 4; dx <= c[0] + 4; dx++) { const n = overlap(A, B, dx, dy); if (n > bn) { bn = n; best = [dx, dy]; } }
    // frame f's pixel (x, y) lands on frame 1's (x + dx, y + dy), both in frame-local coordinates
    f.ax = f0.ax - f0.r[0] - best[0] + f.r[0]; f.ay = f0.ay - best[1];
  }
}

/** The AI frames draw the shadow a little differently each time, so its centre alone still jitters: shift frames 2..4
 *  horizontally (at most 6% of the frame width) so their feet + shadow band (bottom 18% above the anchor) best overlaps
 *  frame 1's. The anchor row stays the shadow bottom. */
function refineFeet(im, fr) {
  const f0 = fr[0], band = Math.round(.18 * (f0.ay - f0.top)), on = (x, y) => im.d[(y * im.w + x) * 4 + 3] >= 128 ? 1 : 0;
  const rows = f => { const out = []; for (let y = f.ay - band; y < f.ay; y++) { const r = new Uint8Array(f.r[1] - f.r[0]); for (let x = f.r[0]; x < f.r[1]; x++) r[x - f.r[0]] = on(x, y); out.push(r); } return out; };
  const A = rows(f0), ax0 = Math.round(f0.ax - f0.r[0]);
  for (const f of fr.slice(1)) {
    const B = rows(f), bx = Math.round(f.ax - f.r[0]), lim = Math.round(.06 * (f.r[1] - f.r[0]));
    let best = 0, bn = -1;
    for (let dx = -lim; dx <= lim; dx++) { let n = 0;   // B pixel at local x maps to A at x - bx - dx + ax0
      for (let k = 0; k < band; k++) { const a = A[k], b = B[k]; for (let x = 0; x < b.length; x++) if (b[x]) { const xa = x - bx - dx + ax0; if (xa >= 0 && xa < a.length) n += a[xa]; } }
      if (n > bn || (n === bn && Math.abs(dx) < Math.abs(best))) { bn = n; best = dx; } }
    f.ax += best; f.feetShift = best;
  }
}

/** w x h window of im at (x0, y0), transparent outside im and outside the frame's x range [a, b). */
function windowOf(im, x0, y0, w, h, [a, b]) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) { const sy = y0 + y; if (sy < 0 || sy >= im.h) continue;
    for (let x = 0; x < w; x++) { const sx = x0 + x; if (sx < a || sx >= b) continue; out.set(im.d.subarray((sy * im.w + sx) * 4, (sy * im.w + sx) * 4 + 4), (y * w + x) * 4); } }
  return { w, h, d: out };
}

function blit(dst, src, ox, oy) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const s = (y * src.w + x) * 4, t = ((oy + y) * dst.w + ox + x) * 4, a = src.d[s + 3] / 255;
    for (let c = 0; c < 3; c++) dst.d[t + c] = Math.round(src.d[s + c] * a + dst.d[t + c] * (1 - a)); dst.d[t + 3] = Math.max(dst.d[t + 3], src.d[s + 3]); }
}

// ---- per class ----------------------------------------------------------------------------------------------

function sheet(cls) {
  const o = OPTS[cls] || {}; let im = load(path.join(RAW, `${cls}.png`)); if (o.flip) im = flipX(im);
  const info = { cls };
  let opaque = true; for (let i = 3; i < im.d.length; i += 4 * 97) if (im.d[i] < 255) { opaque = false; break; }
  if (opaque) {   // fake checker baked in: border flood + selective enclosed-gap removal (never the global --bg-fill)
    const tones = checkerTones(im), stats = { removed: 0, kept: 0, debug: process.env.SPRITES_DEBUG && [] };
    removeBg(im, { bgLum: 190, bgSat: 24, erode: 1, feather: 1, bgEnclosed: enclosedChecker(tones, stats) });
    info.glowPx = glowToAlpha(im); info.shadowPx = shadowToAlpha(im, tones);
    if (stats.debug) {   // SPRITES_DEBUG=<dir>: <cls>_enclosed.png, enclosed bg-like regions green = removed, red = kept
      const dbg = { w: im.w, h: im.h, d: Uint8Array.from(im.d) };
      for (const c of stats.debug) for (const i of c.px) dbg.d.set(c.removed ? [0, 200, 0, 255] : [230, 0, 0, 255], i * 4);
      save(path.join(process.env.SPRITES_DEBUG, `${cls}_enclosed.png`), downscale(dbg, 1100));
      for (const c of stats.debug) if (c.n >= +(process.env.SPRITES_DEBUG_MIN || 200)) console.log(c.removed ? '  removed' : '  kept', c.px[0] % im.w, Math.floor(c.px[0] / im.w), c.n, c.nl, c.nd);
    }
    Object.assign(info, { bg: 'checker', tones: `${tones.light}/${tones.dark}`, enclosedRemoved: stats.removed, enclosedKept: stats.kept });
  } else info.bg = 'alpha';
  defringe(im, { alphaMin: 24, decon: 1 });
  const { split, ranges } = frameRanges(im); info.split = split;
  const sp = ranges.flatMap(r => dropSpecks(im, r)); info.specks = sp.length; if (process.env.SPRITES_DEBUG) console.log('  specks', sp.join(' '));
  const fr = ranges.map(r => ({ r, ...anchorOf(im, r) }));
  if (o.anchor === 'match') alignFrames(im, fr); else refineFeet(im, fr);
  // one scale for the class: the tallest frame reaches the target height, nothing crosses the cell sides
  const up = Math.max(...fr.map(f => f.ay - f.top)), side = Math.max(...fr.map(f => Math.max(f.ax - f.minX, f.maxX + 1 - f.ax)));
  const target = Math.min(HUMANOID_H * (o.size || 1), CELL - 2 * MARGIN);
  const down = Math.max(0, ...fr.map(f => f.low + 1 - f.ay));   // below the anchor: stray pixels, or a flyer's lower frames
  const s = Math.min(target / up, (CELL - 2 * MARGIN) / (up + down), (CELL / 2 - MARGIN) / side);   // output px per source px
  const base = MARGIN + down * s;   // anchor row sits this far above the cell bottom
  const win = Math.round(CELL / s);
  const out = { w: CELL * FRAMES, h: CELL, d: new Uint8Array(CELL * FRAMES * CELL * 4) };
  fr.forEach((f, k) => {
    const x0 = Math.round(f.ax - win / 2), y0 = Math.round(f.ay + base / s) - win;
    const cell = downscale(windowOf(im, x0, y0, win, win, f.r), CELL);
    blit(out, cell, k * CELL, 0);
  });
  save(path.join(OUT, `${cls}.png`), out);
  Object.assign(info, { scale: +s.toFixed(3), height: Math.round(up * s), anchorY: fr.map(f => f.ay).join(','), anchorX: fr.map(f => Math.round(f.ax - f.r[0])).join(','), feetShift: fr.slice(1).map(f => f.feetShift ?? 0).join(',') });
  return { info, out };
}

const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const unknown = only.filter(c => !CLASSES.includes(c));
if (unknown.length) { console.error(`unknown class: ${unknown.join(', ')} (valid: ${CLASSES.join(', ')})`); process.exit(1); }
const done = [];
for (const cls of CLASSES) {
  if (only.length && !only.includes(cls)) continue;
  if (!fs.existsSync(path.join(RAW, `${cls}.png`))) { console.warn(`skip ${cls}: no art/raw/${cls}.png`); continue; }
  try { const { info } = sheet(cls); done.push(cls); console.log(JSON.stringify(info)); }
  catch (e) { console.error(`${cls}: ${e.message} (art/raw/${cls}.png; output not written)`); process.exitCode = 1; }
}

// preview: every existing output sheet stacked on mid grey (leftover checker and eaten pixels both show up)
const sheets = CLASSES.filter(c => fs.existsSync(path.join(OUT, `${c}.png`)));
const prev = { w: CELL * FRAMES, h: CELL * sheets.length, d: new Uint8Array(CELL * FRAMES * CELL * sheets.length * 4) };
for (let i = 0; i < prev.d.length; i += 4) { prev.d[i] = prev.d[i + 1] = prev.d[i + 2] = 128; prev.d[i + 3] = 255; }
sheets.forEach((c, k) => blit(prev, load(path.join(OUT, `${c}.png`)), 0, k * CELL));
save(path.join(ROOT, 'art/preview.png'), prev);
console.log(`wrote ${done.length} sheet(s) to editor/public/sprites/, art/preview.png (${sheets.join(', ')})`);
