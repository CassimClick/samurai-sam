// Minimal, fast XML -> tree parser. Good enough for FFDec's swf2xml and SVG output
// (no DTDs, no CDATA). Nodes: { tag, attrs, children, text }.

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m) => {
    if (ENTITIES[m]) return ENTITIES[m];
    if (m[1] === '#') {
      const code = m[2] === 'x' ? parseInt(m.slice(3, -1), 16) : parseInt(m.slice(2, -1), 10);
      return String.fromCodePoint(code);
    }
    return m;
  });
}

const ATTR_RE = /([\w:.-]+)\s*=\s*"([^"]*)"/g;

function parseAttrs(src) {
  const attrs = {};
  if (!src) return attrs;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(src))) attrs[m[1]] = decodeEntities(m[2]);
  return attrs;
}

export function parseXml(text) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const TAG_RE = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<\?[^>]*\?>|<!--[\s\S]*?-->/g;
  let last = 0;
  let m;
  while ((m = TAG_RE.exec(text))) {
    if (m.index > last) {
      const t = text.slice(last, m.index);
      if (t.trim()) stack[stack.length - 1].text += decodeEntities(t);
    }
    last = TAG_RE.lastIndex;
    if (!m[2]) continue; // processing instruction / comment
    if (m[1]) {
      stack.pop();
      continue;
    }
    const node = { tag: m[2], attrs: parseAttrs(m[3]), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

export const child = (node, tag) => node.children.find((c) => c.tag === tag);
export const children = (node, tag) => node.children.filter((c) => c.tag === tag);
