// ActionScript 2 runtime library used by the translated scripts (see tools/lib/as2.mjs).
import { DisplayObject, MovieClip } from './display';
import type { Player } from './player';
import type { ColorTransform } from './types';

export function createRuntime(player: Player): Record<string, unknown> {
  const audio = player.audio;

  // ------------------------------------------------------------------ Key
  const Key = {
    BACKSPACE: 8, CAPSLOCK: 20, CONTROL: 17, DELETEKEY: 46, DOWN: 40, END: 35, ENTER: 13, ESCAPE: 27,
    HOME: 36, INSERT: 45, LEFT: 37, PGDN: 34, PGUP: 33, RIGHT: 39, SHIFT: 16, SPACE: 32, TAB: 9, UP: 38,
    _listeners: [] as any[],
    isDown(code: any) {
      return player.input.isDown(+code);
    },
    isToggled() {
      return false;
    },
    getCode() {
      return player.input.lastCode;
    },
    getAscii() {
      return player.input.lastAscii;
    },
    addListener(o: any) {
      if (o && !Key._listeners.includes(o)) Key._listeners.push(o);
    },
    removeListener(o: any) {
      const i = Key._listeners.indexOf(o);
      if (i >= 0) Key._listeners.splice(i, 1);
      return i >= 0;
    },
  };

  // ------------------------------------------------------------------ Mouse
  const Mouse = {
    _listeners: [] as any[],
    addListener(o: any) {
      if (o && !Mouse._listeners.includes(o)) Mouse._listeners.push(o);
    },
    removeListener(o: any) {
      const i = Mouse._listeners.indexOf(o);
      if (i >= 0) Mouse._listeners.splice(i, 1);
    },
    hide() {
      player.canvas.style.cursor = 'none';
    },
    show() {
      player.canvas.style.cursor = '';
    },
  };

  // ------------------------------------------------------------------ Sound
  function Sound(this: any, target?: any) {
    Object.defineProperty(this, '$owner', { value: target instanceof DisplayObject ? target : audio.globalOwner, enumerable: false });
    Object.defineProperty(this, '$soundId', { value: 0, writable: true, enumerable: false });
  }
  Sound.prototype.attachSound = function (name: any) {
    const id = player.data.exports[String(name)];
    if (id !== undefined && player.data.chars[id]?.t === 'sound') this.$soundId = id;
  };
  Sound.prototype.start = function (offset?: any, loops?: any) {
    if (!this.$soundId) return;
    const self = this;
    audio.play(this.$soundId, this.$owner, +offset || 0, +loops || 1, () => {
      if (typeof self.onSoundComplete === 'function') self.onSoundComplete();
    });
  };
  Sound.prototype.stop = function (name?: any) {
    if (name !== undefined) {
      const id = player.data.exports[String(name)];
      if (id !== undefined) audio.stopOwner(this.$owner, id);
      return;
    }
    if (this.$owner === audio.globalOwner) audio.stopAll();
    else audio.stopOwner(this.$owner);
  };
  Sound.prototype.setVolume = function (v: any) {
    v = +v;
    if (Number.isFinite(v)) audio.setVolume(this.$owner, v);
  };
  Sound.prototype.getVolume = function () {
    return audio.channel(this.$owner).volume;
  };
  Sound.prototype.setPan = function (p: any) {
    p = +p;
    if (Number.isFinite(p)) audio.setPan(this.$owner, p);
  };
  Sound.prototype.getPan = function () {
    return audio.channel(this.$owner).panValue;
  };
  Sound.prototype.setTransform = function () {};
  Sound.prototype.getTransform = function () {
    return { ll: 100, lr: 0, rr: 100, rl: 0 };
  };
  Sound.prototype.loadSound = function () {};
  Sound.prototype.getBytesLoaded = function () {
    return 1;
  };
  Sound.prototype.getBytesTotal = function () {
    return 1;
  };
  Object.defineProperty(Sound.prototype, 'duration', {
    get(this: any) {
      return audio.duration(this.$soundId);
    },
  });
  Object.defineProperty(Sound.prototype, 'position', {
    get(this: any) {
      return audio.position(this.$owner, this.$soundId);
    },
  });

  // ------------------------------------------------------------------ Color
  function Color(this: any, target: any) {
    Object.defineProperty(this, '$t', { value: target, enumerable: false });
  }
  Color.prototype.setRGB = function (rgb: any) {
    const t = this.$t as DisplayObject;
    if (!(t instanceof DisplayObject)) return;
    const n = +rgb >>> 0;
    const a = t.$cx ? t.$cx[3] : 1;
    const aa = t.$cx ? t.$cx[7] : 0;
    t.$cx = [0, 0, 0, a, (n >> 16) & 255, (n >> 8) & 255, n & 255, aa];
    t.$cxByScript = true;
  };
  Color.prototype.getRGB = function () {
    const t = this.$t as DisplayObject;
    if (!t?.$cx) return 0;
    return ((t.$cx[4] & 255) << 16) | ((t.$cx[5] & 255) << 8) | (t.$cx[6] & 255);
  };
  Color.prototype.setTransform = function (o: any) {
    const t = this.$t as DisplayObject;
    if (!(t instanceof DisplayObject) || !o) return;
    const cur: ColorTransform = t.$cx ? [...t.$cx] as ColorTransform : [1, 1, 1, 1, 0, 0, 0, 0];
    if (o.ra !== undefined) cur[0] = o.ra / 100;
    if (o.ga !== undefined) cur[1] = o.ga / 100;
    if (o.ba !== undefined) cur[2] = o.ba / 100;
    if (o.aa !== undefined) cur[3] = o.aa / 100;
    if (o.rb !== undefined) cur[4] = +o.rb;
    if (o.gb !== undefined) cur[5] = +o.gb;
    if (o.bb !== undefined) cur[6] = +o.bb;
    if (o.ab !== undefined) cur[7] = +o.ab;
    t.$cx = cur;
    t.$cxByScript = true;
  };
  Color.prototype.getTransform = function () {
    const c = (this.$t as DisplayObject)?.$cx ?? [1, 1, 1, 1, 0, 0, 0, 0];
    return { ra: c[0] * 100, ga: c[1] * 100, ba: c[2] * 100, aa: c[3] * 100, rb: c[4], gb: c[5], bb: c[6], ab: c[7] };
  };

  // ------------------------------------------------------------------ XML
  function wrapNode(n: Node, parent: any): any {
    const o: any = {
      nodeType: n.nodeType === 1 ? 1 : 3,
      nodeName: n.nodeType === 1 ? (n as Element).tagName : null,
      nodeValue: n.nodeType === 1 ? null : n.nodeValue,
      attributes: {},
      childNodes: [],
      parentNode: parent,
    };
    if (n.nodeType === 1) for (const a of Array.from((n as Element).attributes)) o.attributes[a.name] = a.value;
    return o;
  }
  function linkChildren(o: any, n: Node, ignoreWhite: boolean) {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType !== 1 && c.nodeType !== 3 && c.nodeType !== 4) continue;
      if (c.nodeType !== 1 && ignoreWhite && !c.nodeValue?.trim()) continue;
      const w = wrapNode(c, o);
      o.childNodes.push(w);
      if (c.nodeType === 1) linkChildren(w, c, ignoreWhite);
    }
    o.childNodes.forEach((ch: any, i: number) => {
      ch.previousSibling = o.childNodes[i - 1] ?? null;
      ch.nextSibling = o.childNodes[i + 1] ?? null;
    });
    o.firstChild = o.childNodes[0] ?? null;
    o.lastChild = o.childNodes[o.childNodes.length - 1] ?? null;
  }
  function XML(this: any, src?: any) {
    this.childNodes = [];
    this.firstChild = null;
    this.lastChild = null;
    this.loaded = false;
    this.status = 0;
    this.ignoreWhite = false;
    if (src !== undefined) this.parseXML(String(src));
  }
  XML.prototype.parseXML = function (text: string) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    this.childNodes = [];
    linkChildren(this, doc, !!this.ignoreWhite);
    this.status = doc.getElementsByTagName('parsererror').length ? -1 : 0;
  };
  XML.prototype.load = function (url: any) {
    const self = this;
    self.loaded = false;
    player
      .fetchText(String(url))
      .then((text) => {
        self.parseXML(text);
        self.loaded = true;
        player.enqueue(() => typeof self.onLoad === 'function' && self.onLoad(true));
      })
      .catch(() => player.enqueue(() => typeof self.onLoad === 'function' && self.onLoad(false)));
    return true;
  };
  XML.prototype.getBytesLoaded = function () {
    return this.loaded ? 1 : 0;
  };
  XML.prototype.getBytesTotal = function () {
    return 1;
  };
  XML.prototype.toString = function () {
    return '[XML]';
  };

  function LoadVars(this: any) {}
  LoadVars.prototype.load = function () {
    return false;
  };
  LoadVars.prototype.sendAndLoad = function () {
    return false;
  };
  LoadVars.prototype.send = function () {
    return false;
  };

  function TextFormat(this: any, font?: any, size?: any, color?: any) {
    this.font = font;
    this.size = size;
    this.color = color;
  }

  const SharedObject = {
    getLocal(name: any) {
      const key = 'samurai-sam:' + name;
      let data: any = {};
      try {
        data = JSON.parse(localStorage.getItem(key) || '{}');
      } catch {
        /* ignore */
      }
      return {
        data,
        flush() {
          try {
            localStorage.setItem(key, JSON.stringify(this.data));
          } catch {
            /* ignore */
          }
          return true;
        },
        clear() {
          this.data = {};
        },
      };
    },
  };

  const start = performance.now();
  const _global: any = {};

  const rt: Record<string, unknown> = {
    Key,
    Mouse,
    Sound,
    Color,
    XML,
    XMLNode: XML,
    LoadVars,
    TextFormat,
    SharedObject,
    MovieClip,
    TextField: function TextField() {},
    Stage: {
      width: player.data.width,
      height: player.data.height,
      scaleMode: 'noScale',
      align: '',
      showMenu: false,
      addListener() {},
      removeListener() {},
    },
    Selection: {
      setFocus() {
        return false;
      },
      getFocus() {
        return null;
      },
      addListener() {},
      removeListener() {},
      setSelection() {},
      getBeginIndex: () => -1,
      getEndIndex: () => -1,
    },
    System: { security: { allowDomain() {}, allowInsecureDomain() {} }, capabilities: { version: 'WIN 8,0,0,0' }, useCodepage: false },
    getTimer: () => Math.floor(performance.now() - start),
    trace: (...a: unknown[]) => {
      if (player.traceEnabled) console.debug('[trace]', ...a);
    },
    setInterval: (fn: any, ms: any, ...args: any[]) => {
      if (typeof fn === 'function') return window.setInterval(() => player.enqueue(() => fn(...args)), +ms);
      if (fn && typeof fn[ms] === 'function') {
        const [delay, ...rest] = args;
        return window.setInterval(() => player.enqueue(() => fn[ms](...rest)), +delay);
      }
      return 0;
    },
    clearInterval: (id: any) => window.clearInterval(id),
    random: (n: any) => {
      n = Math.floor(+n);
      return n > 0 ? Math.floor(Math.random() * n) : 0;
    },
    int: (v: any) => {
      const n = +v;
      return Number.isFinite(n) ? Math.trunc(n) : 0;
    },
    getURL: (url: any, win?: any) => player.openURL(url, win),
    fscommand: () => {},
    removeMovieClip: (t: any) => {
      if (t instanceof MovieClip) t.removeMovieClip();
    },
    duplicateMovieClip: (t: any, name: any, depth: any) => {
      if (t instanceof MovieClip) t.duplicateMovieClip(name, depth);
    },
    _global,
    _root: player.root,
    _level0: player.root,
    chr: (n: any) => String.fromCharCode(+n),
    mbchr: (n: any) => String.fromCharCode(+n),
    ord: (s: any) => String(s).charCodeAt(0),
    mbord: (s: any) => String(s).charCodeAt(0),
    length: (s: any) => String(s).length,
    mblength: (s: any) => String(s).length,
    substring: (s: any, i: any, n: any) => String(s).substr(Math.max(0, +i - 1), +n),
    mbsubstring: (s: any, i: any, n: any) => String(s).substr(Math.max(0, +i - 1), +n),
    newline: '\n',
    ASSetPropFlags: () => {},
    updateAfterEvent: () => {},
    loadMovie: () => {},
    unloadMovie: () => {},
    targetPath: (t: any) => (t instanceof DisplayObject ? t.$targetPath : undefined),
    startDrag: () => {},
    stopDrag: () => {},
    __o: (o: any) => (o === null || o === undefined ? {} : o),
    __new: (ctor: any, args: any[]) => (typeof ctor === 'function' ? new ctor(...args) : undefined),
    __wcall: (target: any, scope: any, name: string, args: any[]) => {
      if (target && typeof target[name] === 'function') return target[name](...args);
      if (scope && typeof scope[name] === 'function') return scope[name](...args);
      return undefined;
    },
  };
  return rt;
}
