// Converts FFDec's SVG export (shapes, static text, morph shapes) into compact draw
// lists the canvas runtime can render as Path2D. Coordinates stay in the symbol's
// local space (the outermost <g> only offsets by -bounds.min, so it is dropped).
import { createHash } from 'node:crypto';
import { parseXml } from './xmltree.mjs';

const IDENTITY = [1, 0, 0, 1, 0, 0];

function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function parseTransform(s) {
  if (!s) return IDENTITY;
  const m = /matrix\(([^)]*)\)/.exec(s);
  if (!m) return IDENTITY;
  const v = m[1].split(/[\s,]+/).filter(Boolean).map(Number);
  return v.length === 6 ? v : IDENTITY;
}

const isIdentity = (m) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
const round = (v) => Math.round(v * 10000) / 10000;

function parseColor(c, opacity = 1) {
  if (!c || c === 'none') return null;
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, round(opacity)];
  }
  m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) {
    const h = m[1];
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), round(opacity)];
  }
  return [0, 0, 0, round(opacity)];
}

function num(v, d = 0) {
  if (v === undefined) return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function gradientStops(node) {
  return node.children
    .filter((c) => c.tag === 'stop')
    .map((s) => {
      const col = parseColor(s.attrs['stop-color'] || '#000000', num(s.attrs['stop-opacity'], 1));
      return [round(num(s.attrs.offset)), ...col];
    });
}

/**
 * @param {string} svgText
 * @param {(dataUri: string, bitmapId?: string) => string} storeImage  persists a fill bitmap, returns its key
 */
export function convertSvg(svgText, storeImage) {
  const doc = parseXml(svgText);
  const svg = doc.children.find((c) => c.tag === 'svg');
  const byId = new Map();
  (function index(n) {
    if (n.attrs && n.attrs.id) byId.set(n.attrs.id, n);
    n.children.forEach(index);
  })(svg);

  const items = [];

  function resolveFill(value, opacity, node) {
    if (!value || value === 'none') return null;
    const ref = /^url\(#(.+)\)$/.exec(value);
    if (!ref) return ['c', ...parseColor(value, opacity)];
    const g = byId.get(ref[1]);
    if (!g) return null;
    if (g.tag === 'linearGradient' || g.tag === 'radialGradient') {
      const gm = parseTransform(g.attrs.gradientTransform);
      const spread = g.attrs.spreadMethod || 'pad';
      const stops = gradientStops(g);
      if (opacity !== 1) stops.forEach((s) => (s[4] = round(s[4] * opacity)));
      if (g.tag === 'linearGradient') {
        return ['l', stops, gm.map(round), num(g.attrs.x1), num(g.attrs.y1), num(g.attrs.x2), num(g.attrs.y2), spread];
      }
      const cx = num(g.attrs.cx), cy = num(g.attrs.cy);
      return ['r', stops, gm.map(round), cx, cy, num(g.attrs.r), num(g.attrs.fx, cx), num(g.attrs.fy, cy), spread];
    }
    if (g.tag === 'pattern') {
      const img = g.children.find((c) => c.tag === 'image');
      if (!img) return null;
      const href = img.attrs['xlink:href'] || img.attrs.href;
      const key = storeImage(href, node.attrs['ffdec:fill-bitmapId']);
      const pm = parseTransform(g.attrs.patternTransform);
      const smooth = !/optimizeSpeed|pixelated/.test(img.attrs.style || '');
      return ['b', key, pm.map(round), num(img.attrs.width), num(img.attrs.height), smooth ? 1 : 0];
    }
    return null;
  }

  function emitPath(node, tf, inherited) {
    const a = withStyle(node.attrs);
    const fillAttr = a.fill !== undefined ? a.fill : inherited.fill;
    const fillOpacity = num(a['fill-opacity'], inherited.fillOpacity ?? 1);
    const item = { d: compactPath(a.d || '') };
    if (!isIdentity(tf)) item.t = tf.map(round);
    const fill = resolveFill(fillAttr, fillOpacity, node);
    if (fill) item.f = fill;
    if (a['fill-rule'] === 'nonzero') item.nz = 1;
    const strokeAttr = a.stroke !== undefined ? a.stroke : inherited.stroke;
    if (strokeAttr && strokeAttr !== 'none') {
      let col = parseColor(strokeAttr, num(a['stroke-opacity'], 1));
      if (!col) {
        const grad = resolveFill(strokeAttr, 1, node);
        col = grad && grad[0] !== 'b' ? grad[1][0].slice(1) : [0, 0, 0, 1];
      }
      item.s = {
        w: num(a['stroke-width'], 1),
        c: col,
        cap: a['stroke-linecap'] || 'round',
        join: a['stroke-linejoin'] || 'round',
      };
      if (a['stroke-miterlimit']) item.s.ml = num(a['stroke-miterlimit']);
    }
    // Morph shapes: FFDec writes start/end values as SMIL <animate> children.
    for (const an of node.children.filter((c) => c.tag === 'animate')) {
      const vals = (an.attrs.values || '').split(';');
      if (vals.length < 2) continue;
      const attr = an.attrs.attributeName;
      if (attr === 'd') item.d2 = compactPath(vals[1]), (item.d = compactPath(vals[0]));
      else if (attr === 'fill' && item.f && item.f[0] === 'c') item.f2 = parseColor(vals[1], item.f[4]);
      else if (attr === 'fill-opacity' && item.f) item.fo2 = num(vals[1], 1);
      else if (attr === 'stroke' && item.s) item.s.c2 = parseColor(vals[1], item.s.c[3]);
      else if (attr === 'stroke-width' && item.s) (item.s.w = num(vals[0], item.s.w)), (item.s.w2 = num(vals[1]));
    }
    if (item.f || item.s) items.push(item);
  }

  function walk(node, tf, inherited, depth) {
    for (const c of node.children) {
      if (c.tag === 'defs' || c.tag === 'pattern' || c.tag === 'linearGradient' || c.tag === 'radialGradient') continue;
      const own = depth === 0 && c.tag === 'g' ? IDENTITY : parseTransform(c.attrs.transform);
      const ctf = mul(tf, own);
      const inh = {
        fill: c.attrs.fill !== undefined ? c.attrs.fill : inherited.fill,
        fillOpacity: c.attrs['fill-opacity'] !== undefined ? num(c.attrs['fill-opacity']) : inherited.fillOpacity,
        stroke: c.attrs.stroke !== undefined ? c.attrs.stroke : inherited.stroke,
      };
      if (c.tag === 'g') walk(c, ctf, inh, depth + 1);
      else if (c.tag === 'path') emitPath(c, ctf, inherited);
      else if (c.tag === 'use') {
        const target = byId.get((c.attrs['xlink:href'] || c.attrs.href || '').slice(1));
        if (!target) continue;
        if (target.tag === 'path') emitPath(target, ctf, inh);
        else walk(target, ctf, inh, depth + 1);
      }
    }
  }

  walk(svg, IDENTITY, { fill: undefined, stroke: undefined }, 0);
  return items;
}

function withStyle(attrs) {
  if (!attrs.style) return attrs;
  const out = { ...attrs };
  for (const decl of attrs.style.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

// Trim float noise in path data ("1.0" -> "1") to keep the JSON small.
function compactPath(d) {
  return d.replace(/(-?\d+)\.0(?![\d])/g, '$1').replace(/\s+/g, ' ').trim();
}

export function hashData(buf) {
  return createHash('sha1').update(buf).digest('hex').slice(0, 16);
}
