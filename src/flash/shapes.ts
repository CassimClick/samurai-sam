import type { ColorTransform, DrawItem, Fill, Matrix, ShapeLibraryData } from './types';
import { cssColor, cxColor, invert, isIdentityCx, multiply } from './matrix';

interface CompiledItem {
  src: DrawItem;
  path: Path2D;
  /** Path pre-transformed into gradient space (gradient fills only). */
  gradPath?: Path2D;
  gradMatrix?: Matrix;
  rule: CanvasFillRule;
  t?: Matrix;
  gradientCache?: Map<string, CanvasGradient>;
  /** Bitmap fill that exactly covers an image-sized rectangle: drawn with drawImage. */
  imageRect?: boolean;
}

interface MorphItem {
  src: DrawItem;
  cmds: string[];
  a: number[];
  b: number[];
  t?: Matrix;
  rule: CanvasFillRule;
}

const PATH_TOKEN = /([MLQCZHVmlqczhv])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/g;

function tokenizePath(d: string): { cmds: string[]; nums: number[] } {
  const cmds: string[] = [];
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  PATH_TOKEN.lastIndex = 0;
  while ((m = PATH_TOKEN.exec(d))) {
    if (m[1]) cmds.push(m[1]);
    else {
      cmds.push('#');
      nums.push(parseFloat(m[2]));
    }
  }
  return { cmds, nums };
}

function buildPath(cmds: string[], nums: number[]): string {
  let out = '';
  let k = 0;
  for (const c of cmds) {
    if (c === '#') out += nums[k++].toFixed(2) + ' ';
    else out += c + ' ';
  }
  return out;
}

export class ShapeLibrary {
  private compiled = new Map<number, CompiledItem[]>();
  private morphs = new Map<number, MorphItem[]>();
  private morphPathCache = new Map<string, Path2D[]>();
  private patterns = new Map<string, CanvasPattern | null>();
  private scratch: CanvasRenderingContext2D;

  constructor(
    private data: ShapeLibraryData,
    private bitmaps: Map<string, HTMLImageElement>,
    private ctx: CanvasRenderingContext2D,
  ) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    this.scratch = c.getContext('2d')!;
  }

  has(id: number): boolean {
    return !!this.data[id];
  }

  get(id: number): CompiledItem[] {
    let items = this.compiled.get(id);
    if (items) return items;
    items = (this.data[id] || []).map((src) => {
      const item: CompiledItem = { src, path: new Path2D(src.d), rule: src.nz ? 'nonzero' : 'evenodd' };
      if (src.t) item.t = src.t;
      const f = src.f;
      if (f && f[0] === 'b') item.imageRect = isImageRect(src.d, f[2], f[3], f[4]);
      if (f && (f[0] === 'l' || f[0] === 'r')) {
        item.gradMatrix = f[2];
        item.gradPath = new Path2D();
        const inv = invert(f[2]);
        item.gradPath.addPath(item.path, new DOMMatrix(inv));
      }
      return item;
    });
    this.compiled.set(id, items);
    return items;
  }

  private getMorph(id: number): MorphItem[] {
    let items = this.morphs.get(id);
    if (items) return items;
    items = (this.data[id] || []).map((src) => {
      const a = tokenizePath(src.d);
      const b = src.d2 ? tokenizePath(src.d2) : a;
      const same = b.nums.length === a.nums.length;
      return { src, cmds: a.cmds, a: a.nums, b: same ? b.nums : a.nums, t: src.t, rule: (src.nz ? 'nonzero' : 'evenodd') as CanvasFillRule };
    });
    this.morphs.set(id, items);
    return items;
  }

  private morphPaths(id: number, ratio: number): Path2D[] {
    const q = Math.round(ratio * 256);
    const key = id + ':' + q;
    let paths = this.morphPathCache.get(key);
    if (paths) return paths;
    const r = q / 256;
    paths = this.getMorph(id).map((it) => {
      const nums = it.a.map((v, i) => v + (it.b[i] - v) * r);
      return new Path2D(buildPath(it.cmds, nums));
    });
    if (this.morphPathCache.size > 4000) this.morphPathCache.clear();
    this.morphPathCache.set(key, paths);
    return paths;
  }

  private pattern(key: string): CanvasPattern | null {
    if (this.patterns.has(key)) return this.patterns.get(key)!;
    const img = this.bitmaps.get(key);
    const p = img && img.complete && img.naturalWidth ? this.ctx.createPattern(img, 'repeat') : null;
    if (p || (img && img.complete)) this.patterns.set(key, p);
    return p;
  }

  private gradient(item: CompiledItem, fill: Fill, cx: ColorTransform | null): CanvasGradient {
    const key = cx ? cx.join(',') : '';
    item.gradientCache ||= new Map();
    let g = item.gradientCache.get(key);
    if (g) return g;
    if (fill[0] === 'l') g = this.ctx.createLinearGradient(fill[3], fill[4], fill[5], fill[6]);
    else if (fill[0] === 'r') g = this.ctx.createRadialGradient(fill[6], fill[7], 0, fill[3], fill[4], fill[5]);
    else throw new Error('not a gradient');
    for (const s of fill[1]) {
      const c = cxColor(cx, s[1], s[2], s[3], s[4]);
      g.addColorStop(Math.min(1, Math.max(0, s[0])), cssColor(c[0], c[1], c[2], c[3]));
    }
    if (item.gradientCache.size > 32) item.gradientCache.clear();
    item.gradientCache.set(key, g);
    return g;
  }

  /** Draws shape `id` with the context already set to the object's world transform. */
  render(id: number, world: Matrix, cx: ColorTransform | null) {
    const ctx = this.ctx;
    const items = this.get(id);
    const useCx = isIdentityCx(cx) ? null : cx;
    for (const it of items) {
      ctx.setTransform(world[0], world[1], world[2], world[3], world[4], world[5]);
      if (it.t) ctx.transform(it.t[0], it.t[1], it.t[2], it.t[3], it.t[4], it.t[5]);
      const f = it.src.f;
      if (f) {
        if (f[0] === 'c') {
          const c = cxColor(useCx, f[1], f[2], f[3], f[4]);
          if (c[3] > 0) {
            ctx.fillStyle = cssColor(c[0], c[1], c[2], c[3]);
            ctx.fill(it.path, it.rule);
          }
        } else if (f[0] === 'l' || f[0] === 'r') {
          const gm = it.gradMatrix!;
          ctx.transform(gm[0], gm[1], gm[2], gm[3], gm[4], gm[5]);
          ctx.fillStyle = this.gradient(it, f, useCx);
          ctx.fill(it.gradPath!, it.rule);
          ctx.setTransform(world[0], world[1], world[2], world[3], world[4], world[5]);
          if (it.t) ctx.transform(it.t[0], it.t[1], it.t[2], it.t[3], it.t[4], it.t[5]);
        } else if (f[0] === 'b') {
          const prevAlpha = ctx.globalAlpha;
          if (useCx) ctx.globalAlpha = prevAlpha * Math.max(0, Math.min(1, useCx[3] + useCx[7] / 255));
          ctx.imageSmoothingEnabled = !!f[5];
          if (it.imageRect) {
            // Clamped edges: avoids the seams a repeating pattern leaves between map tiles.
            const img = this.bitmaps.get(f[1]);
            if (img && img.complete && img.naturalWidth) {
              const pm = f[2];
              ctx.transform(pm[0], pm[1], pm[2], pm[3], pm[4], pm[5]);
              ctx.drawImage(img, 0, 0, f[3], f[4]);
              ctx.setTransform(world[0], world[1], world[2], world[3], world[4], world[5]);
              if (it.t) ctx.transform(it.t[0], it.t[1], it.t[2], it.t[3], it.t[4], it.t[5]);
            }
          } else {
            const p = this.pattern(f[1]);
            if (p) {
              const pm = f[2];
              p.setTransform(new DOMMatrix([pm[0], pm[1], pm[2], pm[3], pm[4], pm[5]]));
              ctx.fillStyle = p;
              ctx.fill(it.path, it.rule);
            }
          }
          ctx.globalAlpha = prevAlpha;
          ctx.imageSmoothingEnabled = true;
        }
      }
      const s = it.src.s;
      if (s) {
        const c = cxColor(useCx, s.c[0], s.c[1], s.c[2], s.c[3]);
        if (c[3] > 0) {
          ctx.strokeStyle = cssColor(c[0], c[1], c[2], c[3]);
          // Flash never draws a scaled stroke thinner than one pixel.
          const scale = Math.sqrt(Math.abs(world[0] * world[3] - world[1] * world[2])) || 1;
          ctx.lineWidth = Math.max(s.w, 1 / scale);
          ctx.lineCap = (s.cap === 'none' ? 'butt' : s.cap) as CanvasLineCap;
          ctx.lineJoin = s.join as CanvasLineJoin;
          if (s.ml) ctx.miterLimit = s.ml;
          ctx.stroke(it.path);
        }
      }
    }
  }

  renderMorph(id: number, ratio: number, world: Matrix, cx: ColorTransform | null) {
    const ctx = this.ctx;
    const items = this.getMorph(id);
    const paths = this.morphPaths(id, ratio);
    const useCx = isIdentityCx(cx) ? null : cx;
    items.forEach((it, i) => {
      ctx.setTransform(world[0], world[1], world[2], world[3], world[4], world[5]);
      if (it.t) ctx.transform(it.t[0], it.t[1], it.t[2], it.t[3], it.t[4], it.t[5]);
      const src = it.src;
      if (src.f && src.f[0] === 'c') {
        const end = src.f2 || [src.f[1], src.f[2], src.f[3], src.f[4]];
        const lerp = (a: number, b: number) => a + (b - a) * ratio;
        let alpha = lerp(src.f[4], end[3]);
        if (src.fo2 !== undefined) alpha = lerp(src.f[4], src.fo2);
        const c = cxColor(useCx, lerp(src.f[1], end[0]), lerp(src.f[2], end[1]), lerp(src.f[3], end[2]), alpha);
        ctx.fillStyle = cssColor(c[0], c[1], c[2], c[3]);
        ctx.fill(paths[i], it.rule);
      }
      if (src.s) {
        const end = src.s.c2 || src.s.c;
        const lerp = (a: number, b: number) => a + (b - a) * ratio;
        const c = cxColor(useCx, lerp(src.s.c[0], end[0]), lerp(src.s.c[1], end[1]), lerp(src.s.c[2], end[2]), lerp(src.s.c[3], end[3]));
        ctx.strokeStyle = cssColor(c[0], c[1], c[2], c[3]);
        ctx.lineWidth = src.s.w2 !== undefined ? lerp(src.s.w, src.s.w2) : src.s.w;
        ctx.lineCap = (src.s.cap === 'none' ? 'butt' : src.s.cap) as CanvasLineCap;
        ctx.lineJoin = src.s.join as CanvasLineJoin;
        ctx.stroke(paths[i]);
      }
    });
  }

  /** Point test in shape-local coordinates. */
  hitTest(id: number, x: number, y: number, ratio = -1): boolean {
    const sc = this.scratch;
    if (ratio >= 0) {
      const paths = this.morphPaths(id, ratio);
      return this.getMorph(id).some((it, i) => {
        let px = x, py = y;
        if (it.t) [px, py] = applyInv(it.t, x, y);
        return sc.isPointInPath(paths[i], px, py, it.rule);
      });
    }
    return this.get(id).some((it) => {
      let px = x, py = y;
      if (it.t) [px, py] = applyInv(it.t, x, y);
      return (it.src.f && sc.isPointInPath(it.path, px, py, it.rule)) || (it.src.s && sc.isPointInStroke(it.path, px, py));
    });
  }

  /** Adds the shape's fill geometry, transformed by `world`, to a clip path. */
  addToClip(clip: Path2D, id: number, world: Matrix, ratio = -1) {
    if (ratio >= 0) {
      const paths = this.morphPaths(id, ratio);
      this.getMorph(id).forEach((it, i) => clip.addPath(paths[i], toDOM(it.t ? multiply(world, it.t) : world)));
      return;
    }
    for (const it of this.get(id)) {
      if (!it.src.f) continue;
      clip.addPath(it.path, toDOM(it.t ? multiply(world, it.t) : world));
    }
  }
}

function applyInv(m: Matrix, x: number, y: number): [number, number] {
  const inv = invert(m);
  return [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]];
}

/** True when path `d` is an axis-aligned rectangle equal to the image area under `pm`. */
function isImageRect(d: string, pm: Matrix, w: number, h: number): boolean {
  if (/[QCHVZqchvz]/.test(d.replace(/^M/, ''))) return false;
  const nums = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g) || []).map(Number);
  if (nums.length < 8 || nums.length > 10) return false;
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  for (let i = 0; i < xs.length - 1; i++) {
    if (Math.abs(xs[i] - xs[i + 1]) > 0.01 && Math.abs(ys[i] - ys[i + 1]) > 0.01) return false;
  }
  if (pm[1] !== 0 || pm[2] !== 0) return false;
  const ix0 = Math.min(pm[4], pm[4] + pm[0] * w), ix1 = Math.max(pm[4], pm[4] + pm[0] * w);
  const iy0 = Math.min(pm[5], pm[5] + pm[3] * h), iy1 = Math.max(pm[5], pm[5] + pm[3] * h);
  const near = (a: number, b: number) => Math.abs(a - b) < 0.06;
  return near(Math.min(...xs), ix0) && near(Math.max(...xs), ix1) && near(Math.min(...ys), iy0) && near(Math.max(...ys), iy1);
}

export function toDOM(m: Matrix): DOMMatrix {
  return new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]);
}
