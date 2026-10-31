import { AudioEngine } from './audio';
import { createRuntime } from './avm1';
import { ButtonObj, DisplayObject, MorphObj, MovieClip, ShapeObj, TextFieldObj, hideInternals } from './display';
import { ShapeLibrary } from './shapes';
import type { EditTextChar, Matrix, ShapeLibraryData, SwfData, TimelineDef } from './types';
import { invert, apply } from './matrix';

type Script = ($: any) => void;
type ScriptTable = Record<string, Script>;

interface QueuedAction {
  clip: DisplayObject | null;
  fn: () => void;
}

/** Keyboard state with Flash key codes (KeyboardEvent.keyCode values match). */
class Input {
  private down = new Set<number>();
  /** Keys released before any game tick saw them pressed; released after the next tick. */
  private pendingUp = new Set<number>();
  private unseen = new Set<number>();
  lastCode = 0;
  lastAscii = 0;

  press(code: number, ascii: number) {
    this.down.add(code);
    this.unseen.add(code);
    this.pendingUp.delete(code);
    this.lastCode = code;
    this.lastAscii = ascii;
  }
  release(code: number) {
    if (this.unseen.has(code)) this.pendingUp.add(code);
    else this.down.delete(code);
  }
  isDown(code: number) {
    return this.down.has(code);
  }
  afterTick() {
    this.unseen.clear();
    for (const c of this.pendingUp) this.down.delete(c);
    this.pendingUp.clear();
  }
  clear() {
    this.down.clear();
    this.pendingUp.clear();
    this.unseen.clear();
  }
}

export interface PlayerOptions {
  canvas: HTMLCanvasElement;
  data: SwfData;
  shapes: ShapeLibraryData;
  bitmaps: Map<string, HTMLImageElement>;
  scriptFactory: (rt: Record<string, unknown>) => ScriptTable;
  audio: AudioEngine;
  fontsLoaded: Set<number>;
  /** Loads a text file the game requests (the level XML files). */
  loadText: (url: string) => Promise<string>;
}

export class Player {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scratchCtx: CanvasRenderingContext2D;
  data: SwfData;
  shapes: ShapeLibrary;
  audio: AudioEngine;
  fontsLoaded: Set<number>;
  root!: MovieClip;
  input = new Input();
  mouseX = 0;
  mouseY = 0;
  baseMatrix: Matrix = [1, 0, 0, 1, 0, 0];
  nextInstanceId = 1;
  traceEnabled = new URLSearchParams(location.search).has('trace');
  tickCount = 0;
  paused = false;
  /** Called at the start of every tick, before any game script runs (used by mods). */
  tickHooks: (() => void)[] = [];

  rt: Record<string, any>;
  private scripts: ScriptTable = {};
  private execList: MovieClip[] = [];
  private queueList: QueuedAction[] = [];
  private external: (() => void)[] = [];
  private loadText: (url: string) => Promise<string>;
  private pressed: DisplayObject | null = null;
  private hovered: DisplayObject | null = null;
  private lastTime = 0;
  private acc = 0;
  private frameMs: number;
  private errorCount = 0;

  constructor(opts: PlayerOptions) {
    this.canvas = opts.canvas;
    this.ctx = opts.canvas.getContext('2d', { alpha: false })!;
    const scratch = document.createElement('canvas');
    scratch.width = scratch.height = 1;
    this.scratchCtx = scratch.getContext('2d')!;
    this.data = opts.data;
    this.audio = opts.audio;
    this.fontsLoaded = opts.fontsLoaded;
    this.loadText = opts.loadText;
    this.shapes = new ShapeLibrary(opts.shapes, opts.bitmaps, this.ctx);
    this.frameMs = 1000 / this.data.frameRate;

    this.root = this.createClip(this.data.root);
    this.root.$name = '_level0';
    this.rt = createRuntime(this);
    this.scripts = opts.scriptFactory(this.rt);
    this.bindInput();
  }

  // ------------------------------------------------------------------ objects
  createClip(def: TimelineDef | null, charId = 0): MovieClip {
    const mc = new MovieClip(this, def);
    mc.$charId = charId;
    mc.$createdTick = this.tickCount;
    hideInternals(mc);
    this.execList.push(mc);
    return mc;
  }

  createTextField(def: EditTextChar, charId = 0): TextFieldObj {
    const tf = new TextFieldObj(this, def);
    tf.$charId = charId;
    hideInternals(tf);
    return tf;
  }

  instantiate(charId: number): DisplayObject | null {
    const def = this.data.chars[charId];
    if (!def) return null;
    let obj: DisplayObject;
    switch (def.t) {
      case 'sprite':
        return this.createClip(def, charId);
      case 'shape':
        obj = new ShapeObj(this);
        break;
      case 'morph':
        obj = new MorphObj(this);
        break;
      case 'button':
        obj = new ButtonObj(this, def);
        break;
      case 'edit':
        return this.createTextField(def, charId);
      default:
        return null;
    }
    obj.$charId = charId;
    hideInternals(obj);
    return obj;
  }

  // ------------------------------------------------------------------ scripts
  script(key: string): Script | undefined {
    return this.scripts[key];
  }

  runScript(clip: DisplayObject, fn: Script) {
    if (clip.$removed) return;
    try {
      fn.call(clip, clip);
    } catch (e) {
      this.reportError(e);
    }
  }

  queueScript(clip: DisplayObject, key: string) {
    const fn = this.scripts[key];
    if (fn) this.queueList.push({ clip, fn: () => fn.call(clip, clip) });
  }

  queueScriptFn(clip: DisplayObject, fn: Script) {
    this.queueList.push({ clip, fn: () => fn.call(clip, clip) });
  }

  queue(clip: DisplayObject | null, fn: () => void) {
    this.queueList.push({ clip, fn });
  }

  /** Thread-safe-ish entry point for async callbacks (XML loads, sound completion, intervals). */
  enqueue(fn: () => void) {
    this.external.push(fn);
  }

  drainQueue() {
    let guard = 0;
    while (this.queueList.length) {
      const a = this.queueList.shift()!;
      if (a.clip && a.clip.$removed) continue;
      try {
        a.fn();
      } catch (e) {
        this.reportError(e);
      }
      if (++guard > 200000) {
        console.error('Action queue overflow');
        this.queueList.length = 0;
      }
    }
  }

  private reportError(e: unknown) {
    if (this.errorCount++ < 50) console.error('[ActionScript error]', e);
  }

  // ------------------------------------------------------------------ main loop
  start() {
    this.root.$init();
    this.drainQueue();
    this.render();
    this.lastTime = performance.now();
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(250, t - this.lastTime);
      this.lastTime = t;
      if (this.paused) return;
      this.acc += dt;
      let ticked = false;
      let n = 0;
      while (this.acc >= this.frameMs && n < 4) {
        this.acc -= this.frameMs;
        this.tick();
        ticked = true;
        n++;
      }
      if (n >= 4) this.acc = 0;
      if (ticked) this.render();
    };
    requestAnimationFrame(loop);
  }

  tick() {
    this.tickCount++;
    for (const hook of this.tickHooks) {
      try {
        hook();
      } catch (e) {
        this.reportError(e);
      }
    }
    // Async results (XML loaded, sounds completed) run at the start of the frame.
    const ext = this.external.splice(0);
    for (const fn of ext) this.queue(null, fn);
    this.drainQueue();

    // Newest clips first (AVM1 execution order): enterFrame, then advance the timeline.
    const list = this.execList;
    for (let i = list.length - 1; i >= 0; i--) {
      const mc = list[i];
      if (mc.$removed || mc.$createdTick === this.tickCount) continue;
      if (mc.$clipEvents?.enterFrame) mc.$fireEvent('enterFrame');
      const oef = (mc as any).onEnterFrame;
      if (typeof oef === 'function') this.queue(mc, () => oef.call(mc));
      mc.$advance();
    }
    this.drainQueue();
    this.input.afterTick();
    if (this.tickCount % 120 === 0) this.execList = this.execList.filter((m) => !m.$removed);
  }

  // ------------------------------------------------------------------ rendering
  resize(cssW: number, cssH: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    const s = (cssW * dpr) / this.data.width;
    this.baseMatrix = [s, 0, 0, s, 0, 0];
    this.render();
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const [r, g, b] = this.data.bg;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    try {
      this.root.$render(this.baseMatrix, null);
    } catch (e) {
      this.reportError(e);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ input
  private bindInput() {
    const GAME_KEYS = new Set([32, 37, 38, 39, 40, 9]);
    window.addEventListener('keydown', (e) => {
      this.audio.resume();
      const code = e.keyCode;
      if (GAME_KEYS.has(code) || (e.target === document.body && !e.metaKey && !e.ctrlKey)) e.preventDefault();
      if (e.repeat && this.input.isDown(code)) return;
      this.input.press(code, e.key.length === 1 ? e.key.charCodeAt(0) : 0);
      this.broadcastKey('onKeyDown', 'keyDown');
    });
    window.addEventListener('keyup', (e) => {
      const code = e.keyCode;
      this.input.release(code);
      this.input.lastCode = code;
      this.broadcastKey('onKeyUp', 'keyUp');
    });
    window.addEventListener('blur', () => this.input.clear());

    const toStage = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouseX = ((e.clientX - r.left) / r.width) * this.data.width;
      this.mouseY = ((e.clientY - r.top) / r.height) * this.data.height;
    };
    this.canvas.addEventListener('pointermove', (e) => {
      toStage(e);
      this.updateHover();
      this.broadcastMouse('onMouseMove', 'mouseMove');
      this.drainQueue();
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.audio.resume();
      toStage(e);
      this.canvas.setPointerCapture(e.pointerId);
      const target = this.pick();
      this.pressed = target;
      if (target) {
        if (target instanceof ButtonObj) {
          target.$setState('down');
          target.$runActions('press');
        } else if (target instanceof MovieClip) target.$fireEvent('press');
        this.callHandler(target, 'onPress');
      }
      this.broadcastMouse('onMouseDown', 'mouseDown');
      this.drainQueue();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      toStage(e);
      const target = this.pick();
      const pressed = this.pressed;
      this.pressed = null;
      if (pressed && !pressed.$removed) {
        if (target === pressed) {
          if (pressed instanceof ButtonObj) {
            pressed.$setState('over');
            pressed.$runActions('release');
          } else if (pressed instanceof MovieClip) pressed.$fireEvent('release');
          this.callHandler(pressed, 'onRelease');
        } else {
          if (pressed instanceof ButtonObj) {
            pressed.$setState('up');
            pressed.$runActions('releaseOutside');
          } else if (pressed instanceof MovieClip) pressed.$fireEvent('releaseOutside');
          this.callHandler(pressed, 'onReleaseOutside');
        }
      }
      this.broadcastMouse('onMouseUp', 'mouseUp');
      this.drainQueue();
      this.updateHover();
    });
  }

  private callHandler(target: DisplayObject, name: string) {
    const fn = (target as any)[name];
    if (typeof fn === 'function') this.queue(target, () => fn.call(target));
  }

  private updateHover() {
    const target = this.pick();
    if (target !== this.hovered) {
      const old = this.hovered;
      this.hovered = target;
      if (old && !old.$removed) {
        if (old instanceof ButtonObj) {
          old.$setState('up');
          old.$runActions('rollOut');
        } else if (old instanceof MovieClip) old.$fireEvent('rollOut');
        this.callHandler(old, 'onRollOut');
      }
      if (target) {
        if (target instanceof ButtonObj) {
          target.$setState(this.pressed === target ? 'down' : 'over');
          target.$runActions('rollOver');
        } else if (target instanceof MovieClip) target.$fireEvent('rollOver');
        this.callHandler(target, 'onRollOver');
      }
      const hand = target && (target as any).useHandCursor !== false;
      this.canvas.style.cursor = hand ? 'pointer' : '';
    }
  }

  /** Topmost mouse-enabled object under the cursor. */
  pick(): DisplayObject | null {
    const visit = (obj: DisplayObject): DisplayObject | null => {
      if (!obj.$visible || obj.$isMask || obj.$removed) return null;
      if (obj instanceof ButtonObj) return obj.$enabled && obj.$hitGlobal(this.mouseX, this.mouseY) ? obj : null;
      if (obj instanceof MovieClip) {
        if (obj !== this.root && obj.$isInteractive()) return obj.$hitGlobal(this.mouseX, this.mouseY) ? obj : null;
        for (let i = obj.$children.length - 1; i >= 0; i--) {
          const c = obj.$children[i];
          if (c.$clipDepth) continue;
          const r = visit(c);
          if (r) return r;
        }
      }
      return null;
    };
    return visit(this.root);
  }

  private broadcastMouse(method: string, clipEvent: string) {
    for (const mc of this.execList) {
      if (mc.$removed) continue;
      if (mc.$clipEvents?.[clipEvent]) mc.$fireEvent(clipEvent);
      const fn = (mc as any)[method];
      if (typeof fn === 'function' && Object.prototype.hasOwnProperty.call(mc, method)) this.queue(mc, () => fn.call(mc));
    }
    const rt = this.runtimeMouse();
    for (const l of [...rt]) if (typeof l[method] === 'function') this.queue(null, () => l[method]());
  }

  private broadcastKey(method: string, clipEvent: string) {
    for (const l of [...this.runtimeKey()]) if (typeof l[method] === 'function') this.queue(null, () => l[method]());
    for (const mc of this.execList) if (!mc.$removed && mc.$clipEvents?.[clipEvent]) mc.$fireEvent(clipEvent);
    this.drainQueue();
  }

  private runtimeKey(): any[] {
    return this.rt.Key._listeners;
  }
  private runtimeMouse(): any[] {
    return this.rt.Mouse._listeners;
  }

  // ------------------------------------------------------------------ misc
  openURL(url: any, _win?: any) {
    if (!url) return;
    const s = String(url);
    if (/^https?:/i.test(s)) window.open(s, '_blank', 'noopener');
  }

  fetchText(url: string): Promise<string> {
    return this.loadText(url);
  }

  stageToLocal(obj: DisplayObject) {
    return apply(invert(obj.$world()), this.mouseX, this.mouseY);
  }
}
