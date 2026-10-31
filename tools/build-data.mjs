// Builds the game's runtime data from the FFDec extraction in .extract/:
//   public/data/bundle.js     characters, timelines, vector shapes, level XML, sounds, fonts
//   public/data/scripts.js    original ActionScript 2 translated to JavaScript
//   public/assets/bitmaps/    bitmaps used by fills
import fs from 'node:fs';
import path from 'node:path';
import { parseXml, child, children } from './lib/xmltree.mjs';
import { convertSvg, hashData } from './lib/svg.mjs';
import { translateBody, splitHandlers, RUNTIME_GLOBALS } from './lib/as2.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EX = path.join(ROOT, '.extract');
const PUB = path.join(ROOT, 'public');
const OUT_DATA = path.join(PUB, 'data');
const OUT_ASSETS = path.join(PUB, 'assets');

for (const d of [OUT_DATA, `${OUT_ASSETS}/bitmaps`, `${OUT_ASSETS}/sounds`, `${OUT_ASSETS}/fonts`, `${PUB}/maps`]) {
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
}

const TWIP = 20;
const r4 = (v) => Math.round(v * 10000) / 10000;

console.log('Parsing swf.xml ...');
const swfDoc = parseXml(fs.readFileSync(path.join(EX, 'swf.xml'), 'utf8'));
const swfNode = child(swfDoc, 'swf');
const rect = (n) => [+n.attrs.Xmin / TWIP, +n.attrs.Ymin / TWIP, +n.attrs.Xmax / TWIP, +n.attrs.Ymax / TWIP];

function matrix(n) {
  if (!n) return undefined;
  const a = n.attrs;
  const m = [
    a.hasScale === 'true' ? +a.scaleX : 1,
    a.hasRotate === 'true' ? +a.rotateSkew0 : 0,
    a.hasRotate === 'true' ? +a.rotateSkew1 : 0,
    a.hasScale === 'true' ? +a.scaleY : 1,
    +(a.translateX || 0) / TWIP,
    +(a.translateY || 0) / TWIP,
  ].map(r4);
  return m;
}

function cxform(n) {
  if (!n) return undefined;
  const a = n.attrs;
  const mult = a.hasMultTerms === 'true';
  const add = a.hasAddTerms === 'true';
  if (!mult && !add) return undefined;
  const v = [
    mult ? +a.redMultTerm / 256 : 1,
    mult ? +a.greenMultTerm / 256 : 1,
    mult ? +a.blueMultTerm / 256 : 1,
    mult ? +(a.alphaMultTerm ?? 256) / 256 : 1,
    add ? +a.redAddTerm : 0,
    add ? +a.greenAddTerm : 0,
    add ? +a.blueAddTerm : 0,
    add ? +(a.alphaAddTerm ?? 0) : 0,
  ].map(r4);
  return v;
}

const rgb = (n) => (n ? [+n.attrs.red, +n.attrs.green, +n.attrs.blue, n.attrs.alpha !== undefined ? +n.attrs.alpha / 255 : 1] : undefined);

// ------------------------------------------------------------------ scripts
const SCRIPT_DIR = path.join(EX, 'scripts', 'scripts');
const scriptOut = []; // [key, jsSource]
const scriptErrors = [];

function addScript(key, asSource, label) {
  try {
    scriptOut.push([key, translateBody(asSource)]);
    return true;
  } catch (e) {
    scriptErrors.push(`${label}: ${e.message}`);
    scriptOut.push([key, `console.warn(${JSON.stringify('untranslated script ' + label)});`]);
    return false;
  }
}

/** Reads frame scripts and clip actions for one timeline folder. */
function readTimelineScripts(dir, keyPrefix) {
  const frames = {}; // frameNo -> { actions: [key], clipActions: { depth: key } }
  if (!fs.existsSync(dir)) return frames;
  for (const fdir of fs.readdirSync(dir)) {
    const m = /^frame_(\d+)$/.exec(fdir);
    if (!m) continue;
    const frameNo = +m[1];
    const entry = (frames[frameNo] = { actions: [], clipActions: {} });
    const full = path.join(dir, fdir);
    const files = fs.readdirSync(full);
    const doActions = files
      .filter((f) => /^DoAction(_\d+)?\.as$/.test(f))
      .sort((a, b) => (+(/_(\d+)/.exec(a)?.[1] || 1)) - (+(/_(\d+)/.exec(b)?.[1] || 1)));
    doActions.forEach((f, i) => {
      const key = `${keyPrefix}_f${frameNo}_${i}`;
      addScript(key, fs.readFileSync(path.join(full, f), 'utf8'), `${keyPrefix}/frame_${frameNo}/${f}`);
      entry.actions.push(key);
    });
    for (const f of files.filter((x) => x.startsWith('PlaceObject'))) {
      const depth = +/_(\d+)$/.exec(f)[1];
      const key = `${keyPrefix}_f${frameNo}_d${depth}`;
      const handlers = {};
      for (const hf of fs.readdirSync(path.join(full, f))) {
        const src = fs.readFileSync(path.join(full, f, hf), 'utf8');
        for (const h of splitHandlers(src)) {
          const hkey = `${key}_${Object.keys(handlers).length}`;
          if (addScript(hkey, h.body, `${keyPrefix}/frame_${frameNo}/${f}/${hf}`)) {
            for (const ev of h.events) (handlers[normalizeEvent(h.kind, ev)] ||= []).push(hkey);
          }
        }
      }
      entry.clipActions[depth] = handlers;
    }
  }
  return frames;
}

function normalizeEvent(kind, ev) {
  // on(release) / onClipEvent(enterFrame) / on(keyPress "<Tab>")
  if (ev.startsWith('keyPress')) return 'keyPress:' + ev.replace(/keyPress\s*/, '').replace(/"/g, '');
  return ev;
}

const scriptFolders = new Map(); // "DefineSprite_123" -> folder name
for (const f of fs.readdirSync(SCRIPT_DIR)) {
  const m = /^(DefineSprite|DefineButton2)_(\d+)/.exec(f);
  if (m) scriptFolders.set(`${m[1]}_${m[2]}`, f);
}

// ------------------------------------------------------------------ characters
const chars = {};
const exportsMap = {};
let rootFrames = null;
let bgColor = [0, 0, 0];

function buildTimeline(tagNodes, scriptInfo) {
  const frames = [];
  let cur = { ops: [] };
  for (const t of tagNodes) {
    const type = t.attrs.type;
    if (type === 'ShowFrameTag') {
      frames.push(cur);
      cur = { ops: [] };
    } else if (type === 'FrameLabelTag') {
      (cur.labels ||= []).push(t.attrs.name);
    } else if (type === 'PlaceObject2Tag' || type === 'PlaceObject3Tag') {
      const a = t.attrs;
      const op = { o: 'p', d: +a.depth };
      if (a.placeFlagMove === 'true') op.mv = 1;
      if (a.placeFlagHasCharacter === 'true') op.c = +a.characterId;
      if (a.placeFlagHasMatrix === 'true') op.m = matrix(child(t, 'matrix'));
      if (a.placeFlagHasColorTransform === 'true') op.cx = cxform(child(t, 'colorTransform')) || [1, 1, 1, 1, 0, 0, 0, 0];
      if (a.placeFlagHasName === 'true') op.n = a.name;
      if (a.placeFlagHasRatio === 'true') op.r = +a.ratio;
      if (a.placeFlagHasClipDepth === 'true') op.cd = +a.clipDepth;
      if (a.placeFlagHasBlendMode === 'true' && +a.blendMode > 1) op.bm = +a.blendMode;
      cur.ops.push(op);
    } else if (type === 'RemoveObject2Tag' || type === 'RemoveObjectTag') {
      cur.ops.push({ o: 'r', d: +t.attrs.depth });
    } else if (type === 'StartSoundTag') {
      const info = child(t, 'soundInfo');
      const s = { id: +t.attrs.soundId };
      if (info) {
        if (info.attrs.syncStop === 'true') s.stop = 1;
        if (info.attrs.syncNoMultiple === 'true') s.noMultiple = 1;
        if (info.attrs.hasLoops === 'true') s.loops = +info.attrs.loopCount;
      }
      (cur.sounds ||= []).push(s);
    }
  }
  // Attach scripts (1-based frame numbers in FFDec folders).
  frames.forEach((f, i) => {
    const s = scriptInfo[i + 1];
    if (!s) return;
    if (s.actions.length) f.as = s.actions;
    for (const op of f.ops) {
      if (op.o === 'p' && s.clipActions[op.d] && Object.keys(s.clipActions[op.d]).length) op.ev = s.clipActions[op.d];
    }
  });
  const labels = {};
  frames.forEach((f, i) => (f.labels || []).forEach((l) => (labels[l] = i + 1)));
  return { frames, labels };
}

const tags = child(swfNode, 'tags').children;
const rootTags = [];
for (const t of tags) {
  const type = t.attrs.type;
  const a = t.attrs;
  switch (type) {
    case 'SetBackgroundColorTag':
      bgColor = rgb(child(t, 'backgroundColor')).slice(0, 3);
      break;
    case 'DefineShapeTag':
    case 'DefineShape2Tag':
    case 'DefineShape3Tag':
    case 'DefineShape4Tag':
      chars[a.shapeId] = { t: 'shape', b: rect(child(t, 'shapeBounds')) };
      break;
    case 'DefineMorphShapeTag':
    case 'DefineMorphShape2Tag':
      chars[a.characterId] = { t: 'morph', b: rect(child(t, 'startBounds')), b2: rect(child(t, 'endBounds')) };
      break;
    case 'DefineTextTag':
    case 'DefineText2Tag':
      chars[a.characterID] = { t: 'shape', b: rect(child(t, 'textBounds')), text: 1 };
      break;
    case 'DefineEditTextTag': {
      const html = a.html === 'true';
      chars[a.characterID] = {
        t: 'edit',
        b: rect(child(t, 'bounds')),
        font: a.hasFont === 'true' ? +a.fontId : undefined,
        size: a.hasFont === 'true' ? +a.fontHeight / TWIP : 12,
        color: a.hasTextColor === 'true' ? rgb(child(t, 'textColor')) : [0, 0, 0, 1],
        align: +(a.align || 0),
        leading: +(a.leading || 0) / TWIP,
        leftMargin: +(a.leftMargin || 0) / TWIP,
        rightMargin: +(a.rightMargin || 0) / TWIP,
        indent: +(a.indent || 0) / TWIP,
        html: html ? 1 : 0,
        text: a.hasText === 'true' ? a.initialText : '',
        variable: a.variableName || undefined,
        multiline: a.multiline === 'true' ? 1 : 0,
        wordWrap: a.wordWrap === 'true' ? 1 : 0,
        outlines: a.useOutlines === 'true' ? 1 : 0,
        border: a.border === 'true' ? 1 : 0,
        selectable: a.noSelect === 'true' ? 0 : 1,
        autoSize: a.autoSize === 'true' ? 1 : 0,
        password: a.password === 'true' ? 1 : 0,
      };
      break;
    }
    case 'DefineFont2Tag':
    case 'DefineFont3Tag':
      chars[a.fontID] = {
        t: 'font',
        name: (a.fontName || '').replace(/\\u0000|\u0000/g, ''),
        bold: a.fontFlagsBold === 'true' ? 1 : 0,
        italic: a.fontFlagsItalic === 'true' ? 1 : 0,
        // DefineFont3 glyph space is 20x finer (EM = 20480) than DefineFont2 (EM = 1024).
        ascent: a.fontAscent ? +a.fontAscent / (type === 'DefineFont3Tag' ? 20480 : 1024) : undefined,
        descent: a.fontDescent ? +a.fontDescent / (type === 'DefineFont3Tag' ? 20480 : 1024) : undefined,
      };
      break;
    case 'DefineSoundTag':
      chars[a.soundId] = { t: 'sound', rate: +a.soundRate, stereo: a.soundType === 'true' ? 1 : 0, samples: +a.soundSampleCount };
      break;
    case 'DefineSpriteTag': {
      const folder = scriptFolders.get(`DefineSprite_${a.spriteId}`);
      const scripts = folder ? readTimelineScripts(path.join(SCRIPT_DIR, folder), `s${a.spriteId}`) : {};
      const tl = buildTimeline(child(t, 'subTags').children, scripts);
      chars[a.spriteId] = { t: 'sprite', ...tl };
      break;
    }
    case 'DefineButton2Tag': {
      const records = children(child(t, 'characters'), 'item').map((r) => {
        const ra = r.attrs;
        let states = '';
        if (ra.buttonStateUp === 'true') states += 'u';
        if (ra.buttonStateOver === 'true') states += 'o';
        if (ra.buttonStateDown === 'true') states += 'd';
        if (ra.buttonStateHitTest === 'true') states += 'h';
        const rec = { c: +ra.characterId, d: +ra.placeDepth, m: matrix(child(r, 'placeMatrix')), s: states };
        const cx = cxform(child(r, 'colorTransform'));
        if (cx) rec.cx = cx;
        return rec;
      });
      const btn = { t: 'button', records, menu: a.trackAsMenu === 'true' ? 1 : 0, actions: {} };
      const folder = scriptFolders.get(`DefineButton2_${a.buttonId}`);
      if (folder) {
        for (const f of fs.readdirSync(path.join(SCRIPT_DIR, folder))) {
          const src = fs.readFileSync(path.join(SCRIPT_DIR, folder, f), 'utf8');
          splitHandlers(src).forEach((h, i) => {
            const key = `b${a.buttonId}_${f.replace(/\W+/g, '')}_${i}`;
            if (addScript(key, h.body, `${folder}/${f}`)) {
              for (const ev of h.events) (btn.actions[normalizeEvent(h.kind, ev)] ||= []).push(key);
            }
          });
        }
      }
      chars[a.buttonId] = btn;
      break;
    }
    case 'ExportAssetsTag': {
      const ids = children(child(t, 'tags'), 'item').map((n) => +n.text);
      const names = children(child(t, 'names'), 'item').map((n) => n.text);
      ids.forEach((cid, i) => (exportsMap[names[i]] = cid));
      break;
    }
    case 'DefineBitsTag':
    case 'DefineBitsJPEG2Tag':
    case 'DefineBitsJPEG3Tag':
    case 'DefineBitsLosslessTag':
    case 'DefineBitsLossless2Tag':
      chars[a.characterID] = { t: 'bitmap' };
      break;
    case 'PlaceObject2Tag':
    case 'PlaceObject3Tag':
    case 'RemoveObject2Tag':
    case 'ShowFrameTag':
    case 'FrameLabelTag':
    case 'StartSoundTag':
    case 'DoActionTag':
      rootTags.push(t);
      break;
    default:
      break;
  }
}
{
  const scripts = readTimelineScripts(SCRIPT_DIR, 'r');
  const tl = buildTimeline(rootTags, scripts);
  rootFrames = tl;
}
// Exported names on sprites (linkage ids)
for (const [name, cid] of Object.entries(exportsMap)) if (chars[cid]) chars[cid].x = name;

// ------------------------------------------------------------------ vector data
console.log('Converting vector shapes ...');
const bitmapKeys = new Map();
const exportedImages = new Map(
  fs.readdirSync(path.join(EX, 'images')).map((f) => [/^(\d+)/.exec(f)?.[1], f]).filter(([k]) => k),
);
function storeImage(dataUri, bitmapId) {
  if (bitmapId && exportedImages.has(bitmapId)) {
    const file = exportedImages.get(bitmapId);
    const key = bitmapId + path.extname(file).toLowerCase();
    if (!bitmapKeys.has(key)) {
      fs.copyFileSync(path.join(EX, 'images', file), path.join(OUT_ASSETS, 'bitmaps', key));
      bitmapKeys.set(key, true);
    }
    return key;
  }
  const m = /^data:image\/(\w+);base64,(.*)$/is.exec(dataUri);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  const ext = m[1].toLowerCase() === 'jpeg' || m[1].toLowerCase() === 'jpg' ? 'jpg' : 'png';
  const key = hashData(buf) + '.' + ext;
  if (!bitmapKeys.has(key)) {
    fs.writeFileSync(path.join(OUT_ASSETS, 'bitmaps', key), buf);
    bitmapKeys.set(key, true);
  }
  return key;
}

const shapes = {};
for (const [dir, kind] of [['shapes', 'shape'], ['texts', 'text'], ['morph', 'morph']]) {
  const full = path.join(EX, dir);
  for (const f of fs.readdirSync(full)) {
    const cid = +/^(\d+)/.exec(f)?.[1];
    if (!cid || !f.endsWith('.svg')) continue;
    shapes[cid] = convertSvg(fs.readFileSync(path.join(full, f), 'utf8'), storeImage);
  }
}

// ------------------------------------------------------------------ sounds & fonts
for (const f of fs.readdirSync(path.join(EX, 'sounds'))) {
  const m = /^(\d+)(?:_.*)?\.(mp3|wav)$/.exec(f);
  if (!m || !chars[m[1]]) continue;
  fs.copyFileSync(path.join(EX, 'sounds', f), path.join(OUT_ASSETS, 'sounds', `${m[1]}.${m[2]}`));
  chars[m[1]].file = `${m[1]}.${m[2]}`;
}
for (const f of fs.readdirSync(path.join(EX, 'fonts'))) {
  const m = /^(\d+)_.*\.woff$/.exec(f);
  if (!m || !chars[m[1]]) continue;
  fs.copyFileSync(path.join(EX, 'fonts', f), path.join(OUT_ASSETS, 'fonts', `${m[1]}.woff`));
  chars[m[1]].file = `${m[1]}.woff`;
}

// ------------------------------------------------------------------ maps
for (const f of ['beach.xml', 'forest.xml']) fs.copyFileSync(path.join(ROOT, 'original', f), path.join(PUB, 'maps', f));

// ------------------------------------------------------------------ write
const header = displayHeader();
function displayHeader() {
  const r = rect(child(swfNode, 'displayRect'));
  return { width: r[2] - r[0], height: r[3] - r[1], frameRate: +swfNode.attrs.frameRate, bg: bgColor };
}
// Everything except bitmaps goes into one classic script, so the game also runs from
// file:// (double-clicking index.html) where fetch() is not allowed.
const b64 = (file) => fs.readFileSync(file).toString('base64');
const bundle = {
  swf: { ...header, chars, exports: exportsMap, root: rootFrames },
  shapes,
  maps: Object.fromEntries(['beach.xml', 'forest.xml'].map((f) => [f, fs.readFileSync(path.join(ROOT, 'original', f), 'utf8')])),
  sounds: {},
  fonts: {},
};
for (const [id, c] of Object.entries(chars)) {
  if (c.t === 'sound' && c.file) bundle.sounds[id] = b64(path.join(OUT_ASSETS, 'sounds', c.file));
  if (c.t === 'font' && c.file) bundle.fonts[id] = b64(path.join(OUT_ASSETS, 'fonts', c.file));
}
fs.writeFileSync(path.join(OUT_DATA, 'bundle.js'), 'window.SAMURAI_DATA = ' + JSON.stringify(bundle) + ';\n');
for (const d of [`${OUT_ASSETS}/sounds`, `${OUT_ASSETS}/fonts`, `${PUB}/maps`]) fs.rmSync(d, { recursive: true, force: true });

const helpers = ['__o', '__new', '__wcall'];
let js = '// Generated by tools/build-data.mjs from the original Samurai Sam ActionScript 2. Do not edit.\n';
js += 'window.SAMURAI_SCRIPTS = function (__rt) {\n';
js += `var ${[...RUNTIME_GLOBALS, ...helpers].map((n) => `${n} = __rt.${n}`).join(',\n  ')};\n`;
js += 'return {\n';
for (const [key, src] of scriptOut) {
  js += `${JSON.stringify(key)}: function ($) {\n${src}\n},\n`;
}
js += '};\n};\n';
fs.writeFileSync(path.join(OUT_DATA, 'scripts.js'), js);

const count = (t) => Object.values(chars).filter((c) => c.t === t).length;
console.log(
  `sprites ${count('sprite')}, shapes ${count('shape')}, morphs ${count('morph')}, buttons ${count('button')}, ` +
    `edit texts ${count('edit')}, sounds ${count('sound')}, fonts ${count('font')}, exports ${Object.keys(exportsMap).length}`,
);
console.log(`scripts translated: ${scriptOut.length - scriptErrors.length}/${scriptOut.length}; bitmaps: ${bitmapKeys.size}`);
if (scriptErrors.length) console.log('Script translation errors:\n  ' + scriptErrors.join('\n  '));
