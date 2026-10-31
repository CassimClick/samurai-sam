// Display list with Flash 8 / AVM1 semantics: MovieClip timelines (play, goto, looping),
// depth-sorted children exposed as named properties, color transforms, masks, buttons,
// text fields and the drawing API. Internal state is kept in non-enumerable "$" fields
// so that ActionScript `for..in` only sees children and script variables, like in Flash.
import type {
  ButtonChar,
  ButtonRecord,
  ColorTransform,
  EditTextChar,
  FontChar,
  Matrix,
  PlaceOp,
  PlaceState,
  Rect,
  TimelineDef,
} from './types';
import {
  IDENTITY,
  apply,
  concatCx,
  cssColor,
  cxColor,
  invert,
  isIdentityCx,
  multiply,
  transformRect,
  unionRect,
} from './matrix';
import type { Player } from './player';

const TIMELINE_DEPTH_OFFSET = -16384;
const DEG = 180 / Math.PI;

/** Makes every own property non-enumerable (engine internals). */
export function hideInternals(o: object) {
  for (const k of Object.keys(o)) Object.defineProperty(o, k, { enumerable: false, writable: true, configurable: true });
}

type Script = ($: any) => void;

export abstract class DisplayObject {
  $player: Player;
  $parent: MovieClip | null = null;
  $depth = 0;
  $name = '';
  $charId = 0;
  $matrix: Matrix = [1, 0, 0, 1, 0, 0];
  $cx: ColorTransform | null = null;
  $visible = true;
  $byScript = false;
  $cxByScript = false;
  $clipDepth = 0;
  $blend = 0;
  $ratio = 0;
  $removed = false;
  $born = 0;
  $fromTimeline = false;
  $decomposed = false;
  $sx = 1;
  $sy = 1;
  $rot = 0;
  $skew = 0;
  $isMask = false;
  $mask: DisplayObject | null = null;

  constructor(player: Player) {
    this.$player = player;
  }

  // ---------------------------------------------------------------- transform
  $setMatrix(m: Matrix) {
    this.$matrix = [m[0], m[1], m[2], m[3], m[4], m[5]];
    this.$decomposed = false;
  }

  $decompose() {
    if (this.$decomposed) return;
    const [a, b, c, d] = this.$matrix;
    this.$sx = Math.hypot(a, b);
    this.$sy = Math.hypot(c, d);
    this.$rot = Math.atan2(b, a);
    this.$skew = Math.atan2(-c, d) - this.$rot;
    this.$decomposed = true;
  }

  $recompose() {
    const rx = this.$rot, ry = this.$rot + this.$skew;
    const m = this.$matrix;
    m[0] = this.$sx * Math.cos(rx);
    m[1] = this.$sx * Math.sin(rx);
    m[2] = -this.$sy * Math.sin(ry);
    m[3] = this.$sy * Math.cos(ry);
  }

  $world(): Matrix {
    let m = this.$matrix;
    for (let p = this.$parent; p; p = p.$parent) m = multiply(p.$matrix, m);
    return m;
  }

  $worldCx(): ColorTransform | null {
    let cx = this.$cx;
    for (let p = this.$parent; p; p = p.$parent) cx = concatCx(p.$cx, cx);
    return cx;
  }

  /** Bounds in the object's own coordinate space (untransformed). */
  abstract $localBounds(): Rect | null;

  $boundsIn(space: DisplayObject | null): Rect | null {
    const lb = this.$localBounds();
    if (!lb) return null;
    let m = this.$world();
    if (space) m = multiply(invert(space.$world()), m);
    return transformRect(m, lb);
  }

  abstract $render(world: Matrix, cx: ColorTransform | null): void;

  /** Shape-accurate point test; (x, y) in this object's local space. */
  abstract $hitLocal(x: number, y: number): boolean;

  $hitGlobal(gx: number, gy: number): boolean {
    const [x, y] = apply(invert(this.$world()), gx, gy);
    return this.$hitLocal(x, y);
  }

  $addToClip(_path: Path2D, _world: Matrix) {}

  $destroy() {
    this.$removed = true;
  }

  get $targetPath(): string {
    if (!this.$parent) return '_level0';
    const parts: string[] = [];
    for (let o: DisplayObject | null = this; o && o.$parent; o = o.$parent) parts.unshift(o.$name);
    return '_level0.' + parts.join('.');
  }
}

// AS-visible properties shared by all display objects.
const commonProps: PropertyDescriptorMap = {
  _x: {
    get(this: DisplayObject) {
      return this.$matrix[4];
    },
    set(this: DisplayObject, v: any) {
      v = +v;
      if (!Number.isFinite(v)) return;
      this.$matrix[4] = Math.trunc(v * 20) / 20;
      this.$byScript = true;
    },
  },
  _y: {
    get(this: DisplayObject) {
      return this.$matrix[5];
    },
    set(this: DisplayObject, v: any) {
      v = +v;
      if (!Number.isFinite(v)) return;
      this.$matrix[5] = Math.trunc(v * 20) / 20;
      this.$byScript = true;
    },
  },
  _xscale: {
    get(this: DisplayObject) {
      this.$decompose();
      return this.$sx * 100;
    },
    set(this: DisplayObject, v: any) {
      v = +v;
      if (!Number.isFinite(v)) return;
      this.$decompose();
      this.$sx = v / 100;
      this.$recompose();
      this.$byScript = true;
    },
  },
  _yscale: {
    get(this: DisplayObject) {
      this.$decompose();
      return this.$sy * 100;
    },
    set(this: DisplayObject, v: any) {
      v = +v;
      if (!Number.isFinite(v)) return;
      this.$decompose();
      this.$sy = v / 100;
      this.$recompose();
      this.$byScript = true;
    },
  },
  _rotation: {
    get(this: DisplayObject) {
      this.$decompose();
      let r = this.$rot * DEG;
      if (r > 180) r -= 360;
      if (r <= -180) r += 360;
      return r;
    },
    set(this: DisplayObject, v: any) {
      v = +v;
      if (!Number.isFinite(v)) return;
      this.$decompose();
      v = v % 360;
      if (v > 180) v -= 360;
      else if (v < -180) v += 360;
      this.$rot = v / DEG;
      this.$recompose();
      this.$byScript = true;
    },
  },
  _alpha: {
    get(this: DisplayObject) {
      return (this.$cx ? this.$cx[3] : 1) * 100;
    },
    set(this: DisplayObject, v: any) {
      v = +v;
      if (!Number.isFinite(v)) return;
      if (!this.$cx) this.$cx = [1, 1, 1, 1, 0, 0, 0, 0];
      else this.$cx = [...this.$cx] as ColorTransform;
      this.$cx[3] = v / 100;
      this.$cxByScript = true;
    },
  },
  _visible: {
    get(this: DisplayObject) {
      return this.$visible;
    },
    set(this: DisplayObject, v: any) {
      this.$visible = !!(typeof v === 'string' ? +v || v === 'true' : v);
    },
  },
  _width: {
    get(this: DisplayObject) {
      const b = this.$parent ? this.$boundsIn(this.$parent) : this.$boundsIn(null);
      return b ? Math.round((b[2] - b[0]) * 20) / 20 : 0;
    },
    set(this: DisplayObject, v: any) {
      v = +v;
      if (!Number.isFinite(v)) return;
      const lb = this.$localBounds();
      if (!lb || lb[2] - lb[0] <= 0) return;
      this.$decompose();
      this.$sx = v / (lb[2] - lb[0]) / Math.max(Math.abs(Math.cos(this.$rot)), 1e-9);
      this.$recompose();
      this.$byScript = true;
    },
  },
  _height: {
    get(this: DisplayObject) {
      const b = this.$parent ? this.$boundsIn(this.$parent) : this.$boundsIn(null);
      return b ? Math.round((b[3] - b[1]) * 20) / 20 : 0;
    },
    set(this: DisplayObject, v: any) {
      v = +v;
      if (!Number.isFinite(v)) return;
      const lb = this.$localBounds();
      if (!lb || lb[3] - lb[1] <= 0) return;
      this.$decompose();
      this.$sy = v / (lb[3] - lb[1]) / Math.max(Math.abs(Math.cos(this.$rot + this.$skew)), 1e-9);
      this.$recompose();
      this.$byScript = true;
    },
  },
  _name: {
    get(this: DisplayObject) {
      return this.$name;
    },
    set(this: DisplayObject, v: any) {
      const p = this.$parent;
      if (p && (p as any)[this.$name] === this) delete (p as any)[this.$name];
      this.$name = String(v);
      if (p) p.$exposeChild(this);
    },
  },
  _parent: {
    get(this: DisplayObject) {
      return this.$parent ?? undefined;
    },
  },
  _root: {
    get(this: DisplayObject) {
      return this.$player.root;
    },
  },
  _target: {
    get(this: DisplayObject) {
      if (!this.$parent) return '/';
      const parts: string[] = [];
      for (let o: DisplayObject | null = this; o && o.$parent; o = o.$parent) parts.unshift(o.$name);
      return '/' + parts.join('/');
    },
  },
  _xmouse: {
    get(this: DisplayObject) {
      return apply(invert(this.$world()), this.$player.mouseX, this.$player.mouseY)[0];
    },
  },
  _ymouse: {
    get(this: DisplayObject) {
      return apply(invert(this.$world()), this.$player.mouseX, this.$player.mouseY)[1];
    },
  },
  _url: { get: () => 'samuraisam.swf' },
  _droptarget: { get: () => '' },
  _quality: { get: () => 'HIGH', set: () => {} },
  _highquality: { get: () => 1, set: () => {} },
  _focusrect: { get: () => false, set: () => {} },
  _soundbuftime: { get: () => 5, set: () => {} },
  _lockroot: { get: () => false, set: () => {} },
  blendMode: {
    get(this: DisplayObject) {
      return this.$blend;
    },
    set(this: DisplayObject, v: any) {
      this.$blend = typeof v === 'number' ? v : BLEND_NAMES.indexOf(String(v));
    },
  },
};
const BLEND_NAMES = ['normal', 'normal', 'layer', 'multiply', 'screen', 'lighten', 'darken', 'difference', 'add', 'subtract', 'invert', 'alpha', 'erase', 'overlay', 'hardlight'];
const BLEND_OPS: Record<number, GlobalCompositeOperation> = {
  3: 'multiply',
  4: 'screen',
  5: 'lighten',
  6: 'darken',
  7: 'difference',
  8: 'lighter',
  13: 'overlay',
  14: 'hard-light',
};
for (const [k, d] of Object.entries(commonProps)) {
  Object.defineProperty(DisplayObject.prototype, k, { ...d, enumerable: false, configurable: true });
}

// ------------------------------------------------------------------- shapes
export class ShapeObj extends DisplayObject {
  $localBounds(): Rect | null {
    const c = this.$player.data.chars[this.$charId] as { b: Rect };
    return c ? c.b : null;
  }
  $render(world: Matrix, cx: ColorTransform | null) {
    if (!this.$visible) return;
    const w = multiply(world, this.$matrix);
    const c = concatCx(cx, this.$cx);
    if (c && c[3] <= 0 && c[7] <= 0) return;
    const ctx = this.$player.ctx;
    const op = this.$blend ? BLEND_OPS[this.$blend] : undefined;
    if (op) ctx.globalCompositeOperation = op;
    this.$player.shapes.render(this.$charId, w, c);
    if (op) ctx.globalCompositeOperation = 'source-over';
  }
  $hitLocal(x: number, y: number) {
    const b = this.$localBounds();
    if (!b || x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    return this.$player.shapes.hitTest(this.$charId, x, y);
  }
  $addToClip(path: Path2D, world: Matrix) {
    this.$player.shapes.addToClip(path, this.$charId, multiply(world, this.$matrix));
  }
}

export class MorphObj extends DisplayObject {
  $localBounds(): Rect | null {
    const c = this.$player.data.chars[this.$charId] as { b: Rect; b2: Rect };
    if (!c) return null;
    const r = this.$ratio / 65535;
    return [0, 1, 2, 3].map((i) => c.b[i] + (c.b2[i] - c.b[i]) * r) as Rect;
  }
  $render(world: Matrix, cx: ColorTransform | null) {
    if (!this.$visible) return;
    const c = concatCx(cx, this.$cx);
    if (c && c[3] <= 0 && c[7] <= 0) return;
    const ctx = this.$player.ctx;
    const op = this.$blend ? BLEND_OPS[this.$blend] : undefined;
    if (op) ctx.globalCompositeOperation = op;
    this.$player.shapes.renderMorph(this.$charId, this.$ratio / 65535, multiply(world, this.$matrix), c);
    if (op) ctx.globalCompositeOperation = 'source-over';
  }
  $hitLocal(x: number, y: number) {
    return this.$player.shapes.hitTest(this.$charId, x, y, this.$ratio / 65535);
  }
  $addToClip(path: Path2D, world: Matrix) {
    this.$player.shapes.addToClip(path, this.$charId, multiply(world, this.$matrix), this.$ratio / 65535);
  }
}

// ------------------------------------------------------------------- drawing API
type GraphicsCmd =
  | { k: 'fill'; color: [number, number, number, number] | null }
  | { k: 'line'; width: number; color: [number, number, number, number] | null }
  | { k: 'M' | 'L'; x: number; y: number }
  | { k: 'Q'; cx: number; cy: number; x: number; y: number }
  | { k: 'end' };

interface GraphicsPath {
  path: Path2D;
  fill: [number, number, number, number] | null;
  line: { width: number; color: [number, number, number, number] } | null;
  bounds: Rect | null;
}

class Graphics {
  cmds: GraphicsCmd[] = [];
  private compiled: GraphicsPath[] | null = null;

  push(c: GraphicsCmd) {
    this.cmds.push(c);
    this.compiled = null;
  }

  compile(): GraphicsPath[] {
    if (this.compiled) return this.compiled;
    const out: GraphicsPath[] = [];
    let cur: GraphicsPath | null = null;
    let fill: [number, number, number, number] | null = null;
    let line: GraphicsPath['line'] = null;
    let px = 0, py = 0;
    const start = () => {
      if (!cur) {
        cur = { path: new Path2D(), fill, line, bounds: null };
        cur.path.moveTo(px, py);
        cur.bounds = [px, py, px, py];
        out.push(cur);
      }
      return cur;
    };
    const grow = (x: number, y: number) => {
      const b = cur!.bounds!;
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    };
    for (const c of this.cmds) {
      if (c.k === 'fill') {
        fill = c.color;
        cur = null;
      } else if (c.k === 'line') {
        line = c.color ? { width: c.width, color: c.color } : null;
        cur = null;
      } else if (c.k === 'end') {
        cur = null;
        fill = null;
      } else if (c.k === 'M') {
        px = c.x;
        py = c.y;
        cur = null;
      } else if (c.k === 'L') {
        start().path.lineTo(c.x, c.y);
        grow(c.x, c.y);
        px = c.x;
        py = c.y;
      } else if (c.k === 'Q') {
        start().path.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
        grow(c.cx, c.cy);
        grow(c.x, c.y);
        px = c.x;
        py = c.y;
      }
    }
    this.compiled = out;
    return out;
  }

  bounds(): Rect | null {
    let r: Rect | null = null;
    for (const p of this.compile()) r = unionRect(r, p.bounds);
    return r;
  }
}

// ------------------------------------------------------------------- MovieClip
export class MovieClip extends DisplayObject {
  $def: TimelineDef | null;
  $frame = 0;
  $playing = true;
  $children: DisplayObject[] = [];
  $clipEvents: Record<string, Script[]> | null = null;
  $graphics: Graphics | null = null;
  $createdTick = 0;
  $enabled = true;
  $hitArea: DisplayObject | null = null;
  $pendingBorn: MovieClip[] | null = null;
  $loadPending = false;

  constructor(player: Player, def: TimelineDef | null) {
    super(player);
    this.$def = def;
  }

  get $totalFrames() {
    return this.$def ? this.$def.frames.length : 1;
  }

  // ---------------------------------------------------------------- children
  $childAtDepth(depth: number): DisplayObject | undefined {
    return this.$children.find((c) => c.$depth === depth);
  }

  $exposeChild(child: DisplayObject) {
    if (!child.$name) return;
    const cur = (this as any)[child.$name];
    if (cur === undefined || cur instanceof DisplayObject) (this as any)[child.$name] = child;
  }

  $insertChild(child: DisplayObject) {
    child.$parent = this;
    const arr = this.$children;
    let i = arr.length;
    while (i > 0 && arr[i - 1].$depth > child.$depth) i--;
    arr.splice(i, 0, child);
    this.$exposeChild(child);
  }

  $removeChild(child: DisplayObject) {
    const i = this.$children.indexOf(child);
    if (i >= 0) this.$children.splice(i, 1);
    if (child.$name && (this as any)[child.$name] === child) {
      delete (this as any)[child.$name];
      // Another child with the same name becomes reachable again.
      const other = this.$children.find((c) => c.$name === child.$name);
      if (other) (this as any)[child.$name] = other;
    }
    child.$destroy();
  }

  $destroy() {
    if (this.$removed) return;
    this.$fireEvent('unload');
    const onUnload = (this as any).onUnload;
    if (typeof onUnload === 'function') this.$player.queue(this, () => onUnload.call(this));
    super.$destroy();
    for (const c of this.$children) c.$destroy();
    this.$player.audio.stopOwner(this);
  }

  // ---------------------------------------------------------------- timeline
  /** Creates frame 1 and queues its scripts (called once, right after creation). */
  $init(bornList?: MovieClip[]) {
    this.$fireEvent('initialize', true);
    this.$fireEvent('construct', true);
    if (!this.$def || !this.$def.frames.length) {
      this.$frame = 1;
      if (bornList) bornList.push(this);
      else this.$queueEntry(1, []);
      return;
    }
    this.$frame = 1;
    const born: MovieClip[] = [];
    this.$applyOps(1, born);
    if (bornList) {
      // Parent queues our frame-1 scripts after its own frame scripts.
      this.$pendingBorn = born;
      bornList.push(this);
    } else {
      this.$queueEntry(1, born);
    }
  }

  /** Queues the scripts of the frame just entered, then newly born children's, then load. */
  $queueEntry(frame: number, born: MovieClip[], fireLoad = true) {
    const fdef = this.$def?.frames[frame - 1];
    if (fdef?.as) for (const key of fdef.as) this.$player.queueScript(this, key);
    if (fdef?.sounds) this.$player.audio.playFrameSounds(fdef.sounds, this);
    for (const child of born) {
      const pending = child.$pendingBorn || [];
      child.$pendingBorn = null;
      child.$queueEntry(1, pending, true);
    }
    if (fireLoad && this.$loadPending) {
      this.$loadPending = false;
      this.$fireEvent('load');
      const onLoad = (this as any).onLoad;
      if (typeof onLoad === 'function') this.$player.queue(this, () => onLoad.call(this));
    }
  }

  $applyOps(frame: number, born: MovieClip[]) {
    const fdef = this.$def!.frames[frame - 1];
    if (!fdef) return;
    for (const op of fdef.ops) {
      const depth = op.d + TIMELINE_DEPTH_OFFSET;
      if (op.o === 'r') {
        const c = this.$childAtDepth(depth);
        if (c) this.$removeChild(c);
        continue;
      }
      const existing = this.$childAtDepth(depth);
      if (op.c !== undefined) {
        if (op.mv && existing && existing.$charId === op.c && !(existing instanceof MovieClip)) {
          this.$updateFromState(existing, op);
          continue;
        }
        if (existing) this.$removeChild(existing);
        this.$placeChild(op, op.c, depth, frame, born);
      } else if (existing) {
        this.$updateFromState(existing, op);
      }
    }
  }

  $updateFromState(obj: DisplayObject, st: PlaceOp | PlaceState) {
    if (st.m && !obj.$byScript) obj.$setMatrix(st.m);
    if (st.cx && !obj.$cxByScript) obj.$cx = isIdentityCx(st.cx) ? null : st.cx;
    if (st.r !== undefined) obj.$ratio = st.r;
    if (st.cd !== undefined) obj.$clipDepth = st.cd + TIMELINE_DEPTH_OFFSET;
  }

  $placeChild(st: PlaceOp | PlaceState, charId: number, depth: number, born: number, bornList: MovieClip[]) {
    const obj = this.$player.instantiate(charId);
    if (!obj) return null;
    obj.$depth = depth;
    obj.$fromTimeline = true;
    obj.$born = born;
    obj.$name = st.n ?? `instance${this.$player.nextInstanceId++}`;
    if (st.m) obj.$setMatrix(st.m);
    if (st.cx && !isIdentityCx(st.cx)) obj.$cx = st.cx;
    if (st.r !== undefined) obj.$ratio = st.r;
    if (st.cd !== undefined) obj.$clipDepth = st.cd + TIMELINE_DEPTH_OFFSET;
    if (st.bm) obj.$blend = st.bm;
    this.$insertChild(obj);
    if (obj instanceof MovieClip) {
      if (st.ev) obj.$setClipEvents(st.ev);
      obj.$loadPending = true;
      obj.$init(bornList);
    } else if (obj instanceof ButtonObj) {
      obj.$setState('up');
    } else if (obj instanceof TextFieldObj) {
      obj.$bindInitial();
    }
    return obj;
  }

  $setClipEvents(ev: Record<string, string[]>) {
    this.$clipEvents = {};
    for (const [name, keys] of Object.entries(ev)) {
      this.$clipEvents[name] = keys.map((k) => this.$player.script(k)).filter(Boolean) as Script[];
    }
  }

  $fireEvent(name: string, immediate = false) {
    const handlers = this.$clipEvents?.[name];
    if (!handlers) return;
    for (const h of handlers) {
      if (immediate) this.$player.runScript(this, h);
      else this.$player.queueScriptFn(this, h);
    }
  }

  $hasClipEvent(name: string) {
    return !!this.$clipEvents?.[name]?.length;
  }

  /** Snapshot of the timeline display list at `frame` (for gotos). */
  $stateAt(frame: number): Map<number, PlaceState> {
    const def = this.$def!;
    const states = (def.$states ||= []);
    for (let i = states.length; i < frame; i++) {
      const cur = new Map(i > 0 ? states[i - 1] : undefined);
      for (const op of def.frames[i].ops) {
        if (op.o === 'r') {
          cur.delete(op.d);
          continue;
        }
        const prev = cur.get(op.d);
        if (op.c !== undefined && !(op.mv && prev && prev.c === op.c && !this.$isSprite(op.c))) {
          cur.set(op.d, { c: op.c, born: i + 1, m: op.m, cx: op.cx, n: op.n, r: op.r, cd: op.cd, bm: op.bm, ev: op.ev });
        } else if (prev) {
          cur.set(op.d, {
            ...prev,
            m: op.m ?? prev.m,
            cx: op.cx ?? prev.cx,
            r: op.r ?? prev.r,
            cd: op.cd ?? prev.cd,
          });
        }
      }
      states[i] = cur;
    }
    return states[frame - 1];
  }

  $isSprite(charId: number) {
    return this.$player.data.chars[charId]?.t === 'sprite';
  }

  $gotoFrame(target: number, stop: boolean) {
    this.$playing = !stop;
    if (!this.$def || !this.$def.frames.length) return;
    const total = this.$def.frames.length;
    target = Math.max(1, Math.min(total, Math.floor(target)));
    if (target === this.$frame) return;
    const born: MovieClip[] = [];
    if (target === this.$frame + 1) {
      this.$frame = target;
      this.$applyOps(target, born);
    } else {
      this.$frame = target;
      this.$reconcile(target, born);
    }
    this.$queueEntry(target, born, false);
  }

  $reconcile(frame: number, born: MovieClip[]) {
    const state = this.$stateAt(frame);
    for (const child of [...this.$children]) {
      if (!child.$fromTimeline || child.$depth >= 0) continue;
      const st = state.get(child.$depth - TIMELINE_DEPTH_OFFSET);
      if (!st || st.c !== child.$charId || st.born !== child.$born) this.$removeChild(child);
      else this.$updateFromState(child, st);
    }
    for (const [d, st] of state) {
      const depth = d + TIMELINE_DEPTH_OFFSET;
      if (!this.$childAtDepth(depth)) this.$placeChild(st, st.c, depth, st.born, born);
    }
  }

  /** Per-tick timeline advance. */
  $advance() {
    if (!this.$playing || !this.$def) return;
    const total = this.$def.frames.length;
    if (total <= 1) return;
    const next = this.$frame >= total ? 1 : this.$frame + 1;
    const born: MovieClip[] = [];
    if (next === 1) this.$reconcile(1, born);
    else this.$applyOps(next, born);
    this.$frame = next;
    this.$queueEntry(next, born, false);
  }

  $resolveFrame(f: any): number | null {
    if (typeof f === 'number') return f;
    if (f === undefined || f === null) return null;
    const s = String(f);
    if (/^\d+$/.test(s)) return +s;
    const labels = this.$def?.labels;
    if (!labels) return null;
    if (labels[s] !== undefined) return labels[s];
    const lower = s.toLowerCase();
    for (const [k, v] of Object.entries(labels)) if (k.toLowerCase() === lower) return v;
    return null;
  }

  // ---------------------------------------------------------------- geometry
  $localBounds(): Rect | null {
    let r: Rect | null = this.$graphics?.bounds() ?? null;
    for (const c of this.$children) {
      if (c.$isMask) continue;
      const b = c.$localBounds();
      if (b) r = unionRect(r, transformRect(c.$matrix, b));
    }
    return r;
  }

  $hitLocal(x: number, y: number): boolean {
    if (this.$hitArea && this.$hitArea !== this) return this.$hitArea.$hitGlobal(...apply(this.$world(), x, y));
    if (this.$graphics) {
      for (const p of this.$graphics.compile()) {
        if (p.fill && this.$player.scratchCtx.isPointInPath(p.path, x, y)) return true;
      }
    }
    for (const c of this.$children) {
      if (!c.$visible || c.$isMask || c.$clipDepth) continue;
      const [lx, ly] = apply(invert(c.$matrix), x, y);
      if (c.$hitLocal(lx, ly)) return true;
    }
    return false;
  }

  $addToClip(path: Path2D, world: Matrix) {
    const w = multiply(world, this.$matrix);
    if (this.$graphics) {
      for (const p of this.$graphics.compile()) {
        if (p.fill) path.addPath(p.path, new DOMMatrix([w[0], w[1], w[2], w[3], w[4], w[5]]));
      }
    }
    for (const c of this.$children) if (!c.$clipDepth) c.$addToClip(path, w);
  }

  // ---------------------------------------------------------------- rendering
  $render(world: Matrix, cx: ColorTransform | null) {
    if (!this.$visible || this.$isMask) return;
    const w = multiply(world, this.$matrix);
    const c = concatCx(cx, this.$cx);
    if (c && c[3] <= 0 && c[7] <= 0) return;
    const ctx = this.$player.ctx;
    const blend = this.$blend ? BLEND_OPS[this.$blend] : undefined;
    let saved = 0;
    if (this.$mask && !this.$mask.$removed) {
      ctx.save();
      saved++;
      const clip = new Path2D();
      const mp = this.$mask.$parent;
      this.$mask.$addToClip(clip, mp ? multiply(this.$player.baseMatrix, mp.$world()) : this.$player.baseMatrix);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clip(clip);
    }
    if (blend) {
      ctx.save();
      saved++;
      ctx.globalCompositeOperation = blend;
    }
    if (this.$graphics) this.$renderGraphics(w, c);
    const maskEnds: number[] = [];
    for (const child of this.$children) {
      while (maskEnds.length && child.$depth > maskEnds[maskEnds.length - 1]) {
        maskEnds.pop();
        ctx.restore();
      }
      if (child.$clipDepth) {
        ctx.save();
        const clip = new Path2D();
        child.$addToClip(clip, w);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clip(clip);
        maskEnds.push(child.$clipDepth);
        continue;
      }
      child.$render(w, c);
    }
    while (maskEnds.pop() !== undefined) ctx.restore();
    while (saved--) ctx.restore();
  }

  $renderGraphics(w: Matrix, cx: ColorTransform | null) {
    const ctx = this.$player.ctx;
    ctx.setTransform(w[0], w[1], w[2], w[3], w[4], w[5]);
    for (const p of this.$graphics!.compile()) {
      if (p.fill) {
        const col = cxColor(cx, ...p.fill);
        ctx.fillStyle = cssColor(...col);
        ctx.fill(p.path);
      }
      if (p.line) {
        const col = cxColor(cx, ...p.line.color);
        ctx.strokeStyle = cssColor(...col);
        ctx.lineWidth = Math.max(p.line.width, 1);
        ctx.stroke(p.path);
      }
    }
  }

  $isInteractive(): boolean {
    const self = this as any;
    return (
      this.$enabled &&
      (typeof self.onPress === 'function' ||
        typeof self.onRelease === 'function' ||
        typeof self.onRollOver === 'function' ||
        typeof self.onRollOut === 'function' ||
        typeof self.onReleaseOutside === 'function' ||
        this.$hasClipEvent('press') ||
        this.$hasClipEvent('release') ||
        this.$hasClipEvent('rollOver') ||
        this.$hasClipEvent('rollOut'))
    );
  }

  // ---------------------------------------------------------------- AS2 methods
  play() {
    this.$playing = true;
  }
  stop() {
    this.$playing = false;
  }
  gotoAndPlay(f: any) {
    const n = this.$resolveFrame(f);
    if (n !== null) this.$gotoFrame(n, false);
  }
  gotoAndStop(f: any) {
    const n = this.$resolveFrame(f);
    if (n !== null) this.$gotoFrame(n, true);
  }
  nextFrame() {
    this.$gotoFrame(this.$frame + 1, true);
  }
  prevFrame() {
    this.$gotoFrame(this.$frame - 1, true);
  }

  attachMovie(linkage: any, name: any, depth: any, init?: any) {
    const id = this.$player.data.exports[String(linkage)];
    if (id === undefined) return undefined;
    const def = this.$player.data.chars[id];
    if (!def || def.t !== 'sprite') return undefined;
    const clip = this.$player.instantiate(id) as MovieClip;
    return this.$addScripted(clip, name, depth, init);
  }

  createEmptyMovieClip(name: any, depth: any) {
    const clip = this.$player.createClip(null);
    return this.$addScripted(clip, name, depth);
  }

  $addScripted(clip: MovieClip, name: any, depth: any, init?: any) {
    depth = Math.floor(+depth) || 0;
    const existing = this.$childAtDepth(depth);
    if (existing) this.$removeChild(existing);
    clip.$depth = depth;
    clip.$name = String(name);
    if (init && typeof init === 'object') for (const k of Object.keys(init)) (clip as any)[k] = init[k];
    this.$insertChild(clip);
    clip.$init();
    return clip;
  }

  createTextField(name: any, depth: any, x: any, y: any, w: any, h: any) {
    depth = Math.floor(+depth) || 0;
    const existing = this.$childAtDepth(depth);
    if (existing) this.$removeChild(existing);
    const tf = this.$player.createTextField({
      t: 'edit', b: [0, 0, +w || 100, +h || 20], size: 12, color: [0, 0, 0, 1], align: 0, leading: 0, leftMargin: 0,
      rightMargin: 0, indent: 0, html: 0, text: '', multiline: 0, wordWrap: 0, outlines: 0, border: 0, selectable: 1,
      autoSize: 0, password: 0,
    });
    tf.$depth = depth;
    tf.$name = String(name);
    tf.$matrix[4] = +x || 0;
    tf.$matrix[5] = +y || 0;
    this.$insertChild(tf);
    return tf;
  }

  duplicateMovieClip(name: any, depth: any, init?: any) {
    const p = this.$parent;
    if (!p) return undefined;
    const clip = this.$player.instantiate(this.$charId);
    if (!(clip instanceof MovieClip)) return undefined;
    clip.$setMatrix(this.$matrix);
    clip.$cx = this.$cx;
    clip.$clipEvents = this.$clipEvents;
    return p.$addScripted(clip, name, depth, init);
  }

  removeMovieClip() {
    if (this.$depth < 0 || !this.$parent) return;
    this.$parent.$removeChild(this);
  }

  swapDepths(target: any) {
    const p = this.$parent;
    if (!p) return;
    let other: DisplayObject | undefined;
    let newDepth: number;
    if (target instanceof DisplayObject) {
      if (target.$parent !== p) return;
      other = target;
      newDepth = target.$depth;
    } else {
      newDepth = Math.floor(+target);
      other = p.$childAtDepth(newDepth);
    }
    const old = this.$depth;
    p.$children = p.$children.filter((c) => c !== this && c !== other);
    this.$depth = newDepth;
    this.$fromTimeline = false;
    insertSorted(p.$children, this);
    if (other) {
      other.$depth = old;
      other.$fromTimeline = false;
      insertSorted(p.$children, other);
    }
  }

  getDepth() {
    return this.$depth;
  }
  getNextHighestDepth() {
    const top = this.$children.length ? this.$children[this.$children.length - 1].$depth : -1;
    return Math.max(0, top + 1);
  }
  getInstanceAtDepth(d: any) {
    return this.$childAtDepth(+d);
  }

  hitTest(x: any, y?: any, shapeFlag?: any) {
    if (x instanceof DisplayObject) {
      const a = this.$boundsIn(null);
      const b = x.$boundsIn(null);
      if (!a || !b) return false;
      return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
    }
    const gx = +x, gy = +y;
    if (shapeFlag) return this.$hitGlobal(gx, gy);
    const b = this.$boundsIn(null);
    return !!b && gx >= b[0] && gx <= b[2] && gy >= b[1] && gy <= b[3];
  }

  getBounds(space?: any) {
    const b = this.$boundsIn(space instanceof DisplayObject ? space : this);
    if (!b) return { xMin: 6710886.35, xMax: 6710886.35, yMin: 6710886.35, yMax: 6710886.35 };
    return { xMin: b[0], xMax: b[2], yMin: b[1], yMax: b[3] };
  }
  getRect(space?: any) {
    return this.getBounds(space);
  }

  localToGlobal(pt: any) {
    if (!pt) return;
    const [x, y] = apply(this.$world(), +pt.x, +pt.y);
    pt.x = x;
    pt.y = y;
  }
  globalToLocal(pt: any) {
    if (!pt) return;
    const [x, y] = apply(invert(this.$world()), +pt.x, +pt.y);
    pt.x = x;
    pt.y = y;
  }

  getBytesLoaded() {
    return 3116534;
  }
  getBytesTotal() {
    return 3116534;
  }
  loadMovie() {}
  unloadMovie() {}
  loadVariables() {}
  getURL(url: any, win?: any) {
    this.$player.openURL(url, win);
  }
  startDrag() {}
  stopDrag() {}
  attachAudio() {}
  setMask(mc: any) {
    if (this.$mask) this.$mask.$isMask = false;
    this.$mask = mc instanceof DisplayObject ? mc : null;
    if (this.$mask) this.$mask.$isMask = true;
  }

  beginFill(rgb: any, alpha?: any) {
    const g = (this.$graphics ||= new Graphics());
    if (rgb === undefined) return g.push({ k: 'fill', color: null });
    const n = +rgb >>> 0;
    g.push({ k: 'fill', color: [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha === undefined ? 1 : +alpha / 100] });
  }
  lineStyle(thickness?: any, rgb?: any, alpha?: any) {
    const g = (this.$graphics ||= new Graphics());
    if (thickness === undefined) return g.push({ k: 'line', width: 0, color: null });
    const n = +(rgb || 0) >>> 0;
    g.push({ k: 'line', width: +thickness, color: [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha === undefined ? 1 : +alpha / 100] });
  }
  moveTo(x: any, y: any) {
    (this.$graphics ||= new Graphics()).push({ k: 'M', x: +x, y: +y });
  }
  lineTo(x: any, y: any) {
    (this.$graphics ||= new Graphics()).push({ k: 'L', x: +x, y: +y });
  }
  curveTo(cx: any, cy: any, x: any, y: any) {
    (this.$graphics ||= new Graphics()).push({ k: 'Q', cx: +cx, cy: +cy, x: +x, y: +y });
  }
  endFill() {
    (this.$graphics ||= new Graphics()).push({ k: 'end' });
  }
  clear() {
    this.$graphics = null;
  }
  createClassObject() {
    return undefined;
  }
  toString() {
    return this.$targetPath;
  }
}

function insertSorted(arr: DisplayObject[], child: DisplayObject) {
  let i = arr.length;
  while (i > 0 && arr[i - 1].$depth > child.$depth) i--;
  arr.splice(i, 0, child);
}

Object.defineProperties(MovieClip.prototype, {
  _currentframe: {
    get(this: MovieClip) {
      return this.$frame;
    },
  },
  _totalframes: {
    get(this: MovieClip) {
      return this.$totalFrames;
    },
  },
  _framesloaded: {
    get(this: MovieClip) {
      return this.$totalFrames;
    },
  },
  enabled: {
    get(this: MovieClip) {
      return this.$enabled;
    },
    set(this: MovieClip, v: any) {
      this.$enabled = !!v;
    },
  },
  hitArea: {
    get(this: MovieClip) {
      return this.$hitArea ?? undefined;
    },
    set(this: MovieClip, v: any) {
      this.$hitArea = v instanceof DisplayObject ? v : null;
    },
  },
  cacheAsBitmap: { get: () => false, set: () => {} },
  filters: { get: () => [], set: () => {} },
  useHandCursor: {
    get(this: any) {
      return this.$handCursor ?? true;
    },
    set(this: any, v: any) {
      Object.defineProperty(this, '$handCursor', { value: !!v, writable: true, enumerable: false, configurable: true });
    },
  },
  tabEnabled: { get: () => undefined, set: () => {} },
  focusEnabled: { get: () => undefined, set: () => {} },
});

// ------------------------------------------------------------------- Button
export class ButtonObj extends DisplayObject {
  $def: ButtonChar;
  $state: 'up' | 'over' | 'down' = 'up';
  $stateChildren: { rec: ButtonRecord; obj: DisplayObject }[] = [];
  $hitChildren: { rec: ButtonRecord; obj: DisplayObject }[] | null = null;
  $enabled = true;

  constructor(player: Player, def: ButtonChar) {
    super(player);
    this.$def = def;
  }

  $setState(state: 'up' | 'over' | 'down') {
    const letter = state === 'up' ? 'u' : state === 'over' ? 'o' : 'd';
    const wanted = this.$def.records.filter((r) => r.s.includes(letter));
    const keep: typeof this.$stateChildren = [];
    for (const sc of this.$stateChildren) {
      if (wanted.includes(sc.rec)) keep.push(sc);
      else sc.obj.$destroy();
    }
    for (const rec of wanted) {
      if (keep.some((k) => k.rec === rec)) continue;
      const obj = this.$makeRecordChild(rec);
      if (obj) keep.push({ rec, obj });
    }
    keep.sort((a, b) => a.rec.d - b.rec.d);
    this.$stateChildren = keep;
    this.$state = state;
  }

  $makeRecordChild(rec: ButtonRecord): DisplayObject | null {
    const obj = this.$player.instantiate(rec.c);
    if (!obj) return null;
    obj.$parent = this as unknown as MovieClip;
    obj.$depth = rec.d;
    if (rec.m) obj.$setMatrix(rec.m);
    if (rec.cx && !isIdentityCx(rec.cx)) obj.$cx = rec.cx;
    if (obj instanceof MovieClip) obj.$init();
    else if (obj instanceof TextFieldObj) obj.$bindInitial();
    return obj;
  }

  $hitObjects() {
    if (!this.$hitChildren) {
      this.$hitChildren = [];
      for (const rec of this.$def.records.filter((r) => r.s.includes('h'))) {
        const obj = this.$makeRecordChild(rec);
        if (obj) this.$hitChildren.push({ rec, obj });
      }
    }
    return this.$hitChildren;
  }

  $localBounds(): Rect | null {
    let r: Rect | null = null;
    for (const { obj } of this.$stateChildren) {
      const b = obj.$localBounds();
      if (b) r = unionRect(r, transformRect(obj.$matrix, b));
    }
    return r;
  }

  $hitLocal(x: number, y: number) {
    for (const { obj } of this.$hitObjects()) {
      const [lx, ly] = apply(invert(obj.$matrix), x, y);
      if (obj.$hitLocal(lx, ly)) return true;
    }
    return false;
  }

  $render(world: Matrix, cx: ColorTransform | null) {
    if (!this.$visible) return;
    const w = multiply(world, this.$matrix);
    const c = concatCx(cx, this.$cx);
    for (const { obj } of this.$stateChildren) obj.$render(w, c);
  }

  $destroy() {
    super.$destroy();
    for (const { obj } of this.$stateChildren) obj.$destroy();
    for (const { obj } of this.$hitChildren || []) obj.$destroy();
  }

  $runActions(event: string) {
    const keys = this.$def.actions[event];
    const scope = this.$parent;
    if (keys && scope) for (const k of keys) this.$player.queueScript(scope, k);
  }
}

Object.defineProperties(ButtonObj.prototype, {
  enabled: {
    get(this: ButtonObj) {
      return this.$enabled;
    },
    set(this: ButtonObj, v: any) {
      this.$enabled = !!v;
    },
  },
  useHandCursor: {
    get(this: any) {
      return this.$handCursor ?? true;
    },
    set(this: any, v: any) {
      Object.defineProperty(this, '$handCursor', { value: !!v, writable: true, enumerable: false, configurable: true });
    },
  },
  tabEnabled: { get: () => undefined, set: () => {} },
});

// ------------------------------------------------------------------- TextField
interface TextRun {
  text: string;
  color?: [number, number, number, number];
  size?: number;
  face?: string;
  bold?: boolean;
  underline?: boolean;
  align?: number;
}

const DEVICE_FONTS: Record<string, string> = {
  _sans: 'Arial, Helvetica, sans-serif',
  _serif: '"Times New Roman", Times, serif',
  _typewriter: '"Courier New", Courier, monospace',
};

function decodeHtmlEntities(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export class TextFieldObj extends DisplayObject {
  $def: EditTextChar;
  $text = '';
  $htmlSource: string | null = null;
  $textColor: [number, number, number, number] | null = null;
  $variable: string | undefined;
  $bounds: Rect;

  constructor(player: Player, def: EditTextChar) {
    super(player);
    this.$def = def;
    this.$variable = def.variable;
    this.$bounds = [...def.b] as Rect;
    if (def.html) {
      this.$htmlSource = def.text;
      this.$text = TextFieldObj.htmlToPlain(def.text);
    } else this.$text = def.text;
  }

  static htmlToPlain(html: string) {
    return decodeHtmlEntities(
      html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*(?=.)/gi, '\n')
        .replace(/<[^>]*>/g, ''),
    );
  }

  /** Text fields bound to a variable initialise it from their own text if it is unset. */
  $bindInitial() {
    const v = this.$variable;
    if (!v) return;
    const target = this.$resolveVarOwner();
    if (!target) return;
    if (target.obj[target.key] === undefined) target.obj[target.key] = this.$text;
  }

  $resolveVarOwner(): { obj: any; key: string } | null {
    let v = this.$variable;
    if (!v) return null;
    let obj: any = this.$parent;
    if (v.startsWith('/')) {
      obj = this.$player.root;
      v = v.slice(1);
    }
    v = v.replace(/:/g, '.').replace(/\//g, '.');
    const parts = v.split('.').filter(Boolean);
    const key = parts.pop()!;
    for (const p of parts) {
      if (!obj) return null;
      if (p === '_root' || p === '_level0') obj = this.$player.root;
      else if (p === '_parent') obj = obj.$parent;
      else obj = obj[p];
    }
    return obj ? { obj, key } : null;
  }

  $currentText(): string {
    if (this.$variable) {
      const t = this.$resolveVarOwner();
      if (t) {
        const v = t.obj[t.key];
        if (v !== undefined && v !== null) {
          const s = String(v);
          if (this.$def.html) return TextFieldObj.htmlToPlain(s);
          return s;
        }
      }
    }
    return this.$text;
  }

  $runs(): TextRun[] {
    const html = this.$def.html ? this.$htmlSource ?? null : null;
    if (this.$variable || !html) return [{ text: this.$currentText() }];
    const runs: TextRun[] = [];
    const stack: TextRun[] = [{ text: '' }];
    const re = /<(\/?)(\w+)([^>]*)>|([^<]+)/g;
    let m: RegExpExecArray | null;
    let firstP = true;
    while ((m = re.exec(html))) {
      const top = stack[stack.length - 1];
      if (m[4] !== undefined) {
        runs.push({ ...top, text: decodeHtmlEntities(m[4]) });
        continue;
      }
      const tag = m[2].toLowerCase();
      if (m[1]) {
        if (tag === 'p') runs.push({ ...top, text: '\n' });
        if (stack.length > 1 && ['font', 'b', 'u', 'p', 'a', 'i'].includes(tag)) stack.pop();
        continue;
      }
      if (tag === 'br') {
        runs.push({ ...top, text: '\n' });
        continue;
      }
      const next: TextRun = { ...top, text: '' };
      const attrs = m[3];
      if (tag === 'font') {
        const color = /color\s*=\s*["']?#([0-9a-f]{6})/i.exec(attrs);
        if (color) {
          const n = parseInt(color[1], 16);
          next.color = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
        }
        const size = /size\s*=\s*["']?(\d+)/i.exec(attrs);
        if (size) next.size = +size[1];
        const face = /face\s*=\s*["']([^"']+)/i.exec(attrs);
        if (face) next.face = face[1];
      } else if (tag === 'b') next.bold = true;
      else if (tag === 'u') next.underline = true;
      else if (tag === 'p') {
        const al = /align\s*=\s*["']?(\w+)/i.exec(attrs);
        if (al) next.align = { left: 0, right: 1, center: 2, justify: 3 }[al[1].toLowerCase()] ?? 0;
        if (!firstP) runs.push({ ...top, text: '' });
        firstP = false;
      }
      stack.push(next);
    }
    while (runs.length && runs[runs.length - 1].text === '\n') runs.pop();
    return runs;
  }

  $fontCss(run: TextRun): { css: string; ascent: number; descent: number } {
    const def = this.$def;
    const font = def.font !== undefined ? (this.$player.data.chars[def.font] as FontChar | undefined) : undefined;
    const size = run.size ?? def.size;
    let family: string;
    if (font && def.outlines && font.file && this.$player.fontsLoaded.has(def.font!)) family = `"swf-font-${def.font}"`;
    else {
      const name = run.face ?? font?.name ?? '_sans';
      family = DEVICE_FONTS[name] ?? `"${name}", Arial, sans-serif`;
    }
    const bold = run.bold || font?.bold ? 'bold ' : '';
    const italic = font?.italic ? 'italic ' : '';
    return {
      css: `${italic}${bold}${size}px ${family}`,
      ascent: (font?.ascent ?? 0.9) * size,
      descent: (font?.descent ?? 0.22) * size,
    };
  }

  $localBounds(): Rect | null {
    return this.$bounds;
  }

  $hitLocal(x: number, y: number) {
    const b = this.$bounds;
    return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  }

  $render(world: Matrix, cx: ColorTransform | null) {
    if (!this.$visible) return;
    const w = multiply(world, this.$matrix);
    const c = concatCx(cx, this.$cx);
    if (c && c[3] <= 0 && c[7] <= 0) return;
    const ctx = this.$player.ctx;
    const def = this.$def;
    const b = this.$bounds;
    ctx.save();
    ctx.setTransform(w[0], w[1], w[2], w[3], w[4], w[5]);
    if (def.border) {
      ctx.strokeStyle = cssColor(...cxColor(c, 0, 0, 0, 1));
      ctx.lineWidth = 1;
      ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    }
    ctx.beginPath();
    ctx.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    ctx.clip();

    // Lay out runs into lines.
    const runs = this.$runs();
    type Piece = { text: string; run: TextRun; font: ReturnType<TextFieldObj['$fontCss']>; width: number };
    const lines: { pieces: Piece[]; width: number; ascent: number; descent: number; align: number }[] = [];
    let line = { pieces: [] as Piece[], width: 0, ascent: 0, descent: 0, align: def.align };
    const maxW = b[2] - b[0] - 4 - def.leftMargin - def.rightMargin;
    const pushLine = () => {
      if (!line.ascent) {
        const f = this.$fontCss(runs[0] || { text: '' });
        line.ascent = f.ascent;
        line.descent = f.descent;
      }
      lines.push(line);
      line = { pieces: [], width: 0, ascent: 0, descent: 0, align: def.align };
    };
    for (const run of runs) {
      const font = this.$fontCss(run);
      ctx.font = font.css;
      const segments = (def.password ? run.text.replace(/[^\n\r]/g, '*') : run.text).split(/\r\n|\r|\n/);
      segments.forEach((seg, si) => {
        if (si > 0) {
          if (def.multiline || def.html) pushLine();
          else return;
        }
        if (run.align !== undefined) line.align = run.align;
        const words = def.wordWrap ? seg.split(/(\s+)/) : [seg];
        for (const word of words) {
          if (!word) continue;
          const width = ctx.measureText(word).width;
          if (def.wordWrap && line.width + width > maxW && line.pieces.length && word.trim()) pushLine();
          if (def.wordWrap && !line.pieces.length && !word.trim()) continue;
          line.pieces.push({ text: word, run, font, width });
          line.width += width;
          line.ascent = Math.max(line.ascent, font.ascent);
          line.descent = Math.max(line.descent, font.descent);
        }
      });
    }
    pushLine();

    let y = b[1] + 2;
    for (const ln of lines) {
      y += ln.ascent;
      let x = b[0] + 2 + def.leftMargin + def.indent;
      const free = maxW - ln.width;
      if (ln.align === 1) x += free;
      else if (ln.align === 2) x += free / 2;
      for (const p of ln.pieces) {
        const base = p.run.color ?? this.$textColor ?? def.color;
        const col = cxColor(c, base[0], base[1], base[2], base[3]);
        ctx.font = p.font.css;
        ctx.fillStyle = cssColor(...col);
        ctx.fillText(p.text, x, y);
        if (p.run.underline) ctx.fillRect(x, y + 1.5, p.width, Math.max(1, p.font.ascent / 14));
        x += p.width;
      }
      y += ln.descent + def.leading;
    }
    ctx.restore();
  }
}

Object.defineProperties(TextFieldObj.prototype, {
  text: {
    get(this: TextFieldObj) {
      return this.$currentText();
    },
    set(this: TextFieldObj, v: any) {
      this.$text = v === undefined ? '' : String(v);
      if (this.$def.html) this.$htmlSource = this.$text.replace(/</g, '&lt;');
      const t = this.$resolveVarOwner();
      if (t) t.obj[t.key] = this.$text;
    },
  },
  htmlText: {
    get(this: TextFieldObj) {
      return this.$htmlSource ?? this.$text;
    },
    set(this: TextFieldObj, v: any) {
      const s = v === undefined ? '' : String(v);
      if (this.$def.html) {
        this.$htmlSource = s;
        this.$text = TextFieldObj.htmlToPlain(s);
      } else this.$text = s;
    },
  },
  textColor: {
    get(this: TextFieldObj) {
      const c = this.$textColor ?? this.$def.color;
      return (c[0] << 16) | (c[1] << 8) | c[2];
    },
    set(this: TextFieldObj, v: any) {
      const n = +v >>> 0;
      this.$textColor = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    },
  },
  length: {
    get(this: TextFieldObj) {
      return this.$currentText().length;
    },
  },
  variable: {
    get(this: TextFieldObj) {
      return this.$variable ?? null;
    },
    set(this: TextFieldObj, v: any) {
      this.$variable = v ? String(v) : undefined;
    },
  },
  html: { get(this: TextFieldObj) { return !!this.$def.html; }, set() {} },
  selectable: { get: () => false, set: () => {} },
  border: { get: () => false, set: () => {} },
  autoSize: { get: () => 'none', set: () => {} },
  multiline: { get(this: TextFieldObj) { return !!this.$def.multiline; }, set() {} },
  wordWrap: { get(this: TextFieldObj) { return !!this.$def.wordWrap; }, set() {} },
  embedFonts: { get: () => true, set: () => {} },
  tabEnabled: { get: () => undefined, set: () => {} },
});

export { TIMELINE_DEPTH_OFFSET, IDENTITY };
