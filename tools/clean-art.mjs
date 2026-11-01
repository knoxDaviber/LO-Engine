// clean-art.mjs: defringe / background-remove / crop / fade / trim AI-generated art.
//
// Single file:  node tools/clean-art.mjs <in> <out> [options]
// Copied from the designer's catch-up/tools (PNG only here; the JPEG path and the --all batch mode were dropped).
// The helpers are exported for tools/sprites.mjs.
//
// Options (all optional):
//   --alpha-min N     pixels with alpha < N become alpha 0, RGB 0 (default 24; 0 disables)
//   --bg              flood-fill from the border over background-like pixels (white, light grey
//                     checker squares, cream) and make them transparent
//   --bg-lum N        min brightness (min channel) for a bg-like pixel (default 190)
//   --bg-sat N        max (max-min channel) spread for bg-like (default 40)
//   --bg-fill         also remove bg-like pixels NOT connected to the border (enclosed gaps)
//                     (API only: o.bgEnclosed(im, bgMask, like) marks enclosed regions selectively instead)
//   --feather N       soften the keyed edge by N px (default 1.5)
//   --erode N         shrink the keyed edge by N px to eat leftover light rim (default 1)
//   --crop x,y,w,h    crop before anything else
//   --flip            mirror left-right (after --crop), e.g. so a fish faces right
//   --fade-bottom N   fade alpha to 0 over the bottom N px
//   --fade-sides N    fade alpha to 0 over the left and right N px
//   --key-blue        make blue sky see-through (alpha falls as blue exceeds red), leaving the clouds
//   --trim [margin]   crop to opaque bounding box + margin px (default margin 4)
//   --decon 0|1       lightly pull semi-transparent edge colour toward inner colour (default 1)
//   --largest [N]     keep only the biggest piece (opaque pixels within N px are one piece, default 4): drops neighbours' slivers caught in a crop
//   --max-side N      downscale (box filter) so the long side is at most N
//   --split           <out> is a folder: cut a sheet of separate pieces into one trimmed PNG each (see split() below)
//   --min-area N      --split: blobs smaller than N px are dropped unless they sit by a bigger piece (default 40)
//   --merge N         --split: opaque pixels within N px of each other are one piece, so a tuft's loose blades stay whole (default 2)
//   --split-alpha N   --split: alpha at or above N counts as part of a piece (default 1)
// Input and output .png (RGBA).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

export const load = f => { const p = PNG.sync.read(fs.readFileSync(f)); return { w: p.width, h: p.height, d: Uint8Array.from(p.data) }; };

export function save(f, im) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const p = new PNG({ width: im.w, height: im.h }); p.data = Buffer.from(im.d); fs.writeFileSync(f, PNG.sync.write(p, { colorType: 6 }));
}

export function crop(im, x, y, w, h) {
  x = Math.max(0, x); y = Math.max(0, y); w = Math.min(w, im.w - x); h = Math.min(h, im.h - y);
  const d = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) d.set(im.d.subarray(((y + j) * im.w + x) * 4, ((y + j) * im.w + x + w) * 4), j * w * 4);
  return { w, h, d };
}

export const flipX = im => { const d = new Uint8Array(im.d.length); for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) d.set(im.d.subarray((y * im.w + x) * 4, (y * im.w + x) * 4 + 4), (y * im.w + im.w - 1 - x) * 4); return { w: im.w, h: im.h, d }; };

export function boxBlur(src, w, h, r) { // float array, separable box blur
  r = Math.round(r); if (r < 1) return src;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[y * w + x] = s / n; s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / n; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return out;
}

export function removeBg(im, o) {
  const { w, h, d } = im, N = w * h, lum = o.bgLum, sat = o.bgSat;
  const like = i => { const p = i * 4; if (d[p + 3] < 24) return true; const r = d[p], g = d[p + 1], b = d[p + 2], mn = Math.min(r, g, b); return mn >= lum && Math.max(r, g, b) - mn <= sat; };
  const bg = new Uint8Array(N), st = [];
  const push = i => { if (!bg[i] && like(i)) { bg[i] = 1; st.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) { const i = st.pop(), x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < N - w) push(i + w); }
  if (o.bgFill) { for (let i = 0; i < N; i++) if (like(i)) bg[i] = 1; }
  else if (o.bgEnclosed) o.bgEnclosed(im, bg, like);   // caller decides which enclosed bg-like regions go (tools/sprites.mjs)
  let keep = new Float32Array(N); for (let i = 0; i < N; i++) keep[i] = bg[i] ? 0 : 1;
  // erode: a pixel survives only if the min of its neighbourhood is kept
  for (let k = 0; k < Math.round(o.erode); k++) { const nk = Float32Array.from(keep); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (keep[i] && ((x && !keep[i - 1]) || (x < w - 1 && !keep[i + 1]) || (y && !keep[i - w]) || (y < h - 1 && !keep[i + w]))) nk[i] = 0; } keep = nk; }
  const soft = boxBlur(keep, w, h, o.feather);
  for (let i = 0; i < N; i++) d[i * 4 + 3] = keep[i] ? Math.round(d[i * 4 + 3] * soft[i]) : 0;
}

export function defringe(im, o) {
  const { w, h, d } = im, t = o.alphaMin;
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] < t) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = d[i * 4 + 3] = 0; }
  if (!o.decon) return;
  const src = Uint8Array.from(d); // pull soft-edge colour 50% toward mean of solid neighbours (5x5)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = (y * w + x) * 4, a = src[p + 3]; if (a === 0 || a >= 250) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) { const xx = x + k, yy = y + j; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = (yy * w + xx) * 4; if (src[q + 3] >= 250) { r += src[q]; g += src[q + 1]; b += src[q + 2]; n++; } }
    if (n) { d[p] = (src[p] + r / n) / 2; d[p + 1] = (src[p + 1] + g / n) / 2; d[p + 2] = (src[p + 2] + b / n) / 2; } }
}

export function fadeBottom(im, n) { for (let y = Math.max(0, im.h - n); y < im.h; y++) { const f = (im.h - 1 - y) / n; for (let x = 0; x < im.w; x++) { const p = (y * im.w + x) * 4 + 3; im.d[p] = Math.round(im.d[p] * f); } } }

export function fadeSides(im, n) { for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) { const f = Math.min(1, x / n, (im.w - 1 - x) / n); if (f < 1) { const p = (y * im.w + x) * 4 + 3; im.d[p] = Math.round(im.d[p] * f); } } }
export function keyBlue(im) { const d = im.d; for (let i = 0; i < d.length; i += 4) { const k = Math.min(1, Math.max(0, (d[i + 2] - d[i] + 4) / 64)); d[i + 3] = Math.round(d[i + 3] * (1 - k * k * (3 - 2 * k))); } }

export function largest(im, merge) {
  const { w, h, d } = im, N = w * h, on = new Float32Array(N); for (let i = 0; i < N; i++) on[i] = d[i * 4 + 3] ? 1 : 0;
  const near = boxBlur(on, w, h, merge), lab = new Int32Array(N), cnt = [0];
  for (let s = 0; s < N; s++) { if (lab[s] || !(near[s] > 1e-6)) continue; const id = cnt.length, st = [s]; lab[s] = id; cnt.push(0);
    while (st.length) { const i = st.pop(), x = i % w; cnt[id] += on[i]; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < N && !lab[j] && near[j] > 1e-6) { lab[j] = id; st.push(j); } } }
  const best = cnt.indexOf(Math.max(...cnt)); for (let i = 0; i < N; i++) if (lab[i] !== best) d[i * 4 + 3] = 0;
}

export function trim(im, m, t) {
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.d[(y * im.w + x) * 4 + 3] >= t) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return im;
  return crop(im, x0 - m, y0 - m, x1 - x0 + 1 + 2 * m, y1 - y0 + 1 + 2 * m);
}

export function downscale(im, max) {
  const s = Math.max(im.w, im.h) / max; if (s <= 1) return im;
  const w = Math.round(im.w / s), h = Math.round(im.h / s), d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const xa = Math.floor(x * s), xb = Math.max(xa + 1, Math.floor((x + 1) * s)), ya = Math.floor(y * s), yb = Math.max(ya + 1, Math.floor((y + 1) * s)); let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let j = ya; j < yb && j < im.h; j++) for (let i = xa; i < xb && i < im.w; i++) { const q = (j * im.w + i) * 4, al = im.d[q + 3]; r += im.d[q] * al; g += im.d[q + 1] * al; b += im.d[q + 2] * al; a += al; n++; }
    const p = (y * w + x) * 4; if (a) { d[p] = r / a; d[p + 1] = g / a; d[p + 2] = b / a; } d[p + 3] = a / n; }
  return { w, h, d };
}

export function clean(inFile, outFile, o = {}) {
  o = { alphaMin: 24, bgLum: 190, bgSat: 40, feather: 1.5, erode: 1, decon: 1, ...o };
  let im = load(inFile);
  if (o.crop) im = crop(im, ...o.crop);
  if (o.flip) im = flipX(im);
  if (o.bg) removeBg(im, o);
  defringe(im, o);
  if (o.keyBlue) keyBlue(im);
  if (o.largest) largest(im, o.largest === true ? 4 : +o.largest);
  if (o.fadeBottom) fadeBottom(im, o.fadeBottom);
  if (o.fadeSides) fadeSides(im, o.fadeSides);
  if (o.trim != null && o.trim !== false) im = trim(im, o.trim === true ? 4 : +o.trim, o.alphaMin || 1);
  if (o.maxSide) im = downscale(im, o.maxSide);
  save(outFile, im);
  return { w: im.w, h: im.h };
}

/** --split: a sheet of separate pieces on transparency (or white, with --bg) -> one trimmed PNG per piece in the folder outDir.
 *  Pixels with alpha >= splitAlpha form the pieces: those within `merge` px of each other are one piece (so a tuft's loose blades or a leafy clump stay whole), and
 *  pieces under minArea px are dropped. `classes` names them, first match wins: [{ name, green?, minW?, maxW?, maxHW? }] (green: grass-coloured rather than grey or brown,
 *  true or false; minW/maxW: box width in px; maxHW: height / width at most). Each piece is written as <name>_<n>.png (default name "piece"), numbered top to bottom, left to right, its box trimmed to `trim` px (default 4). */
export function split(inFile, outDir, o = {}) {
  o = { alphaMin: 24, bgLum: 190, bgSat: 40, feather: 1.5, erode: 1, decon: 1, splitAlpha: 1, minArea: 40, merge: 2, classes: [{ name: 'piece' }], ...o };
  let im = load(inFile); if (o.crop) im = crop(im, ...o.crop);
  if (o.bg) removeBg(im, o); defringe(im, o);
  const { w, h, d } = im, N = w * h, on = new Float32Array(N); for (let i = 0; i < N; i++) on[i] = d[i * 4 + 3] >= o.splitAlpha ? 1 : 0;
  const near = o.merge >= 1 ? boxBlur(on, w, h, o.merge) : on, lab = new Int32Array(N), ps = [null];   // near > 0: within `merge` px of an opaque pixel
  for (let s = 0; s < N; s++) { if (lab[s] || !(near[s] > 1e-6)) continue;
    const b = { id: ps.length, x0: w, y0: h, x1: 0, y1: 0, n: 0, r: 0, g: 0, bl: 0 }, st = [s]; lab[s] = b.id; ps.push(b);
    while (st.length) { const i = st.pop(), x = i % w, y = (i - x) / w;
      if (on[i]) { const a = d[i * 4 + 3]; b.n++; b.r += d[i * 4] * a; b.g += d[i * 4 + 1] * a; b.bl += d[i * 4 + 2] * a; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy, j = yy * w + xx; if (xx >= 0 && yy >= 0 && xx < w && yy < h && !lab[j] && near[j] > 1e-6) { lab[j] = b.id; st.push(j); } } } }
  const pieces = ps.slice(1).filter(b => b.n >= o.minArea);
  const green = p => p.bl < p.g * .76, byName = {};
  pieces.forEach(p => { const pw = p.x1 - p.x0 + 1, ph = p.y1 - p.y0 + 1; p.cls = o.classes.find(c => (c.green == null || c.green === green(p)) && pw >= (c.minW || 0) && pw <= (c.maxW || 1e9) && ph / pw <= (c.maxHW || 1e9));
    if (p.cls) (byName[p.cls.name] ||= []).push(p); if (o.verbose) console.log(p.cls?.name, p.x0, p.y0, pw + 'x' + ph, 'n', p.n, 'rgb', [p.r, p.g, p.bl].map(v => Math.round(v / p.n / 255)).join(',')); });
  fs.mkdirSync(outDir, { recursive: true }); const out = [], m = o.trim == null || o.trim === true ? 4 : +o.trim;
  for (const [name, list] of Object.entries(byName)) {
    list.sort((a, b) => Math.round(a.y0 / 60) - Math.round(b.y0 / 60) || a.x0 - b.x0).forEach((p, k) => {
      let pc = crop(im, p.x0 - m, p.y0 - m, p.x1 - p.x0 + 1 + 2 * m, p.y1 - p.y0 + 1 + 2 * m); const x0 = Math.max(0, p.x0 - m), y0 = Math.max(0, p.y0 - m);
      for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) { const l = lab[(y0 + y) * w + x0 + x]; if (l && l !== p.id) pc.d[(y * pc.w + x) * 4 + 3] = 0; }   // another piece's pixels inside this box
      if (o.maxSide) pc = downscale(pc, o.maxSide);
      const f = path.join(outDir, `${name}_${k + 1}.png`); save(f, pc); out.push(`${path.basename(f)} ${pc.w}x${pc.h}`); }); }
  return out;
}

function parseArgs(a) {
  const o = {}, pos = [], num = ['alphaMin', 'bgLum', 'bgSat', 'feather', 'erode', 'fadeBottom', 'fadeSides', 'decon', 'maxSide', 'minArea', 'merge', 'splitAlpha'];
  for (let i = 0; i < a.length; i++) { if (!a[i].startsWith('--')) { pos.push(a[i]); continue; }
    const k = a[i].slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase()), nx = a[i + 1];
    if (k === 'only') o.only = a[++i];
    else if (k === 'crop') o.crop = a[++i].split(',').map(Number);
    else if (k === 'trim' || k === 'largest') o[k] = nx && /^\d+$/.test(nx) ? +a[++i] : true;
    else if (num.includes(k)) o[k] = +a[++i];
    else o[k] = true; }
  return { o, pos };
}

if (globalThis.process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(globalThis.process.argv[1])) {
  const { o, pos } = parseArgs(globalThis.process.argv.slice(2));
  if (pos.length >= 2 && o.split) console.log(split(pos[0], pos[1], o).join('\n'));
  else if (pos.length >= 2) { const r = clean(pos[0], pos[1], o); console.log(pos[1], r.w + 'x' + r.h); }
  else { console.error('usage: node tools/clean-art.mjs <in> <out> [options]  (see header)'); globalThis.process.exitCode = 1; }
}
