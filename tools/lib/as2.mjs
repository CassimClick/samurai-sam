// Translates FFDec-decompiled ActionScript 2 into JavaScript that keeps AS2 semantics:
//  * unqualified names resolve against the owning timeline ("$"), like the AVM1 scope chain
//  * reading/calling through undefined never throws (AS2 silently yields undefined)
//  * Flash 4 word operators (and, or, not, ne, eq, ...) become JS operators
//  * tellTarget()/with() blocks address the target clip
import * as acorn from 'acorn';
import { generate } from 'astring';

// Names provided by the runtime (declared once in the generated wrapper).
export const RUNTIME_GLOBALS = [
  'Key', 'Sound', 'XML', 'XMLNode', 'Color', 'Mouse', 'Stage', 'Selection', 'System', 'SharedObject',
  'LoadVars', 'TextFormat', 'TextField', 'MovieClip', 'getTimer', 'trace', 'setInterval', 'clearInterval',
  'random', 'int', 'getURL', 'fscommand', 'removeMovieClip', 'duplicateMovieClip', '_global', '_root',
  '_level0', 'chr', 'ord', 'newline', 'ASSetPropFlags', 'updateAfterEvent', 'loadMovie', 'unloadMovie',
  'targetPath', 'startDrag', 'stopDrag', 'mbchr', 'mbord', 'mblength', 'mbsubstring', 'substring', 'length',
];
const JS_GLOBALS = [
  'Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'Function', 'Error', 'parseInt',
  'parseFloat', 'isNaN', 'isFinite', 'escape', 'unescape', 'undefined', 'NaN', 'Infinity', 'arguments',
];
const GLOBALS = new Set([...RUNTIME_GLOBALS, ...JS_GLOBALS]);
// Plain (non-optional) member access is safe on these.
const SAFE_BASES = new Set(['Math', 'Key', 'Stage', 'Mouse', 'Selection', 'System', 'Number', 'String', 'Array', 'Object', '_global']);
// AVM1 property names are case-insensitive; FFDec prints SetProperty targets as _X, _Y, ...
const AVM1_PROPS = ['_x', '_y', '_xscale', '_yscale', '_currentframe', '_totalframes', '_alpha', '_visible',
  '_width', '_height', '_rotation', '_target', '_framesloaded', '_name', '_droptarget', '_url', '_highquality',
  '_focusrect', '_soundbuftime', '_quality', '_xmouse', '_ymouse'];
const PROP_CASE = new Map(AVM1_PROPS.map((p) => [p.toLowerCase(), p]));

const WORD_OPS = { and: '&&', or: '||', not: '!', ne: '!=', eq: '==', lt: '<', gt: '>', le: '<=', ge: '>=', add: '+' };

// Replace Flash 4 word operators outside strings/comments. Property names (after ".") are left alone.
function replaceWordOps(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      out += src.slice(i, j < 0 ? n : j);
      i = j < 0 ? n : j;
    } else if (ch === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      out += src.slice(i, j < 0 ? n : j + 2);
      i = j < 0 ? n : j + 2;
    } else if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const prev = out.replace(/\s+$/, '').slice(-1);
      if (WORD_OPS[word] && prev !== '.') {
        const op = WORD_OPS[word];
        out += /\w/.test(op) ? op : ` ${op} `;
      } else out += word;
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

// Split "on(release){...}" / "onClipEvent(load){...}" handler files into separate bodies.
export function splitHandlers(src) {
  const handlers = [];
  const re = /^(on|onClipEvent)\(([^)]*)\)\s*\{\s*$/gm;
  let m;
  const starts = [];
  while ((m = re.exec(src))) starts.push({ index: m.index, end: re.lastIndex, kind: m[1], arg: m[2] });
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    const stop = k + 1 < starts.length ? starts[k + 1].index : src.length;
    const chunk = src.slice(s.end, stop);
    const close = chunk.lastIndexOf('\n}');
    const body = close >= 0 ? chunk.slice(0, close) : chunk.replace(/\}\s*$/, '');
    const events = s.arg.split(',').map((e) => e.trim()).filter(Boolean);
    handlers.push({ kind: s.kind, events, body });
  }
  return handlers;
}

// ---------------------------------------------------------------- AST helpers
const id = (name) => ({ type: 'Identifier', name });
const lit = (value) => ({ type: 'Literal', value, raw: JSON.stringify(value) });
const member = (object, property, computed = false, optional = false) => ({
  type: 'MemberExpression', object, property, computed, optional,
});
const call = (callee, args, optional = false) => ({ type: 'CallExpression', callee, arguments: args, optional });
const chain = (expression) => ({ type: 'ChainExpression', expression });
const SCOPE = id('$');

function collectDeclarations(body, names) {
  // var / function declarations of one function body (not descending into nested functions)
  (function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) names.add(d.id.name);
    } else if (node.type === 'FunctionDeclaration') {
      names.add(node.id.name);
      return;
    } else if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') return;
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  })(body);
}

class Scope {
  constructor(parent, names, isFunction) {
    this.parent = parent;
    this.names = names;
    this.isFunction = isFunction;
  }
  isLocal(name) {
    for (let s = this; s; s = s.parent) if (s.isFunction && s.names.has(name)) return true;
    return false;
  }
}

class Translator {
  constructor() {
    this.withDepth = 0;
    this.withVars = [];
  }

  // Resolve a free identifier in expression position.
  ref(name, scope) {
    if (scope.isLocal(name)) return id(name);
    const lower = PROP_CASE.get(name.toLowerCase());
    const prop = lower || name;
    if (this.withVars.length && prop.startsWith('_')) return member(id(this.withVars[this.withVars.length - 1]), id(prop));
    if (GLOBALS.has(name)) return id(name);
    return member(SCOPE, id(prop));
  }

  isSafeBase(node) {
    return (
      node.type === 'ThisExpression' ||
      (node.type === 'Identifier' && (node.name === '$' || SAFE_BASES.has(node.name) || node.name.startsWith('__w')))
    );
  }

  // Build a safe read of obj.prop
  read(object, property, computed) {
    if (this.isSafeBase(object)) return member(object, property, computed);
    return chain(member(object, property, computed, true));
  }

  // Object expression usable as an assignment base: __o(x) yields a throwaway object for null/undefined.
  assignBase(object) {
    if (this.isSafeBase(object)) return object;
    return call(id('__o'), [object]);
  }

  expr(node, scope) {
    if (!node) return node;
    switch (node.type) {
      case 'Identifier':
        return this.ref(node.name, scope);
      case 'ThisExpression':
        return scope.isFunction ? node : SCOPE;
      case 'Literal':
        return node;
      case 'MemberExpression':
        return this.read(this.expr(node.object, scope), this.prop(node, scope), node.computed);
      case 'CallExpression':
        return this.callExpr(node, scope);
      case 'NewExpression': {
        const args = node.arguments.map((a) => this.expr(a, scope));
        if (node.callee.type === 'Identifier' && GLOBALS.has(node.callee.name) && !scope.isLocal(node.callee.name)) {
          return { type: 'NewExpression', callee: id(node.callee.name), arguments: args };
        }
        return call(id('__new'), [this.expr(node.callee, scope), { type: 'ArrayExpression', elements: args }]);
      }
      case 'AssignmentExpression':
        return { ...node, left: this.target(node.left, scope), right: this.expr(node.right, scope) };
      case 'UpdateExpression':
        return { ...node, argument: this.target(node.argument, scope) };
      case 'UnaryExpression':
        if (node.operator === 'delete') {
          const a = node.argument;
          if (a.type === 'MemberExpression') {
            return { ...node, argument: member(this.assignBase(this.expr(a.object, scope)), this.prop(a, scope), a.computed) };
          }
          if (a.type === 'Identifier' && !scope.isLocal(a.name)) return { ...node, argument: member(SCOPE, id(a.name)) };
          return node;
        }
        return { ...node, argument: this.expr(node.argument, scope) };
      case 'BinaryExpression':
      case 'LogicalExpression':
        return { ...node, left: this.expr(node.left, scope), right: this.expr(node.right, scope) };
      case 'ConditionalExpression':
        return {
          ...node,
          test: this.expr(node.test, scope),
          consequent: this.expr(node.consequent, scope),
          alternate: this.expr(node.alternate, scope),
        };
      case 'SequenceExpression':
        return { ...node, expressions: node.expressions.map((e) => this.expr(e, scope)) };
      case 'ArrayExpression':
        return { ...node, elements: node.elements.map((e) => this.expr(e, scope)) };
      case 'ObjectExpression':
        return {
          ...node,
          properties: node.properties.map((p) => ({ ...p, value: this.expr(p.value, scope), shorthand: false })),
        };
      case 'FunctionExpression':
        return this.func(node, scope);
      default:
        throw new Error('Unsupported expression: ' + node.type);
    }
  }

  prop(node, scope) {
    if (node.computed) return this.expr(node.property, scope);
    return id(PROP_CASE.get(node.property.name.toLowerCase()) || node.property.name);
  }

  callExpr(node, scope) {
    const args = node.arguments.map((a) => this.expr(a, scope));
    const c = node.callee;
    if (c.type === 'MemberExpression') {
      const obj = this.expr(c.object, scope);
      const fn = member(obj, this.prop(c, scope), c.computed, !this.isSafeBase(obj));
      return chain(call(fn, args, true));
    }
    if (c.type === 'Identifier') {
      if (scope.isLocal(c.name)) return call(id(c.name), args);
      if (this.withVars.length) {
        // with(target){ beginFill(...) } -> target method if it exists, else timeline function
        const w = id(this.withVars[this.withVars.length - 1]);
        return call(id('__wcall'), [w, SCOPE, lit(c.name), { type: 'ArrayExpression', elements: args }]);
      }
      if (GLOBALS.has(c.name)) return call(id(c.name), args);
      return chain(call(member(SCOPE, id(c.name)), args, true));
    }
    return chain(call(this.expr(c, scope), args, true));
  }

  // Assignment / update target
  target(node, scope) {
    if (node.type === 'Identifier') {
      if (scope.isLocal(node.name)) return node;
      const lower = PROP_CASE.get(node.name.toLowerCase());
      if (this.withVars.length && lower) return member(id(this.withVars[this.withVars.length - 1]), id(lower));
      return member(SCOPE, id(lower || node.name));
    }
    if (node.type === 'MemberExpression') {
      return member(this.assignBase(this.expr(node.object, scope)), this.prop(node, scope), node.computed);
    }
    throw new Error('Unsupported assignment target: ' + node.type);
  }

  func(node, scope) {
    const names = new Set(node.params.map((p) => p.name));
    names.add('arguments');
    if (node.type === 'FunctionExpression' && node.id) names.add(node.id.name);
    collectDeclarations(node.body, names);
    const inner = new Scope(scope, names, true);
    return { ...node, body: this.block(node.body, inner) };
  }

  block(node, scope) {
    return { ...node, body: this.stmts(node.body, scope) };
  }

  stmts(list, scope) {
    const out = [];
    const hoisted = [];
    for (const s of list) {
      const r = this.stmt(s, scope);
      if (!r) continue;
      if (r.__hoist) hoisted.push(r.node);
      else out.push(r);
    }
    return [...hoisted, ...out];
  }

  stmt(node, scope) {
    switch (node.type) {
      case 'ExpressionStatement':
        return { ...node, expression: this.expr(node.expression, scope) };
      case 'BlockStatement':
        return this.block(node, scope);
      case 'EmptyStatement':
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'DebuggerStatement':
        return node;
      case 'IfStatement':
        return {
          ...node,
          test: this.expr(node.test, scope),
          consequent: this.stmt(node.consequent, scope) || { type: 'EmptyStatement' },
          alternate: node.alternate ? this.stmt(node.alternate, scope) || { type: 'EmptyStatement' } : null,
        };
      case 'ForStatement':
        return {
          ...node,
          init: node.init
            ? node.init.type === 'VariableDeclaration'
              ? this.varDecl(node.init, scope, true)
              : this.expr(node.init, scope)
            : null,
          test: this.expr(node.test, scope),
          update: this.expr(node.update, scope),
          body: this.stmt(node.body, scope) || { type: 'EmptyStatement' },
        };
      case 'ForInStatement': {
        let left;
        if (node.left.type === 'VariableDeclaration') {
          const name = node.left.declarations[0].id.name;
          left = scope.isLocal(name) ? node.left : member(SCOPE, id(name));
        } else left = this.target(node.left, scope);
        return { ...node, left, right: this.expr(node.right, scope), body: this.stmt(node.body, scope) || { type: 'EmptyStatement' } };
      }
      case 'WhileStatement':
      case 'DoWhileStatement':
        return { ...node, test: this.expr(node.test, scope), body: this.stmt(node.body, scope) || { type: 'EmptyStatement' } };
      case 'ReturnStatement':
        return { ...node, argument: node.argument ? this.expr(node.argument, scope) : null };
      case 'ThrowStatement':
        return { ...node, argument: this.expr(node.argument, scope) };
      case 'VariableDeclaration':
        return this.varDecl(node, scope, false);
      case 'FunctionDeclaration': {
        const fn = this.func({ ...node, type: 'FunctionExpression' }, scope);
        if (scope.isFunction) return { ...fn, type: 'FunctionDeclaration' };
        // Timeline-level function: becomes a timeline member, hoisted like AS2 does.
        return {
          __hoist: true,
          node: { type: 'ExpressionStatement', expression: { type: 'AssignmentExpression', operator: '=', left: member(SCOPE, id(node.id.name)), right: fn } },
        };
      }
      case 'SwitchStatement':
        return {
          ...node,
          discriminant: this.expr(node.discriminant, scope),
          cases: node.cases.map((c) => ({ ...c, test: c.test ? this.expr(c.test, scope) : null, consequent: this.stmts(c.consequent, scope) })),
        };
      case 'TryStatement':
        return {
          ...node,
          block: this.block(node.block, scope),
          handler: node.handler
            ? { ...node.handler, body: this.block(node.handler.body, new Scope(scope, new Set([node.handler.param.name]), true)) }
            : null,
          finalizer: node.finalizer ? this.block(node.finalizer, scope) : null,
        };
      case 'LabeledStatement':
        return { ...node, body: this.stmt(node.body, scope) };
      case 'WithStatement': {
        const v = '__w' + this.withDepth++;
        const obj = this.expr(node.object, scope);
        this.withVars.push(v);
        const body = this.stmt(node.body, scope);
        this.withVars.pop();
        return {
          type: 'BlockStatement',
          body: [
            { type: 'VariableDeclaration', kind: 'var', declarations: [{ type: 'VariableDeclarator', id: id(v), init: obj }] },
            { type: 'IfStatement', test: id(v), consequent: body, alternate: null },
          ],
        };
      }
      default:
        throw new Error('Unsupported statement: ' + node.type);
    }
  }

  varDecl(node, scope, inFor) {
    if (scope.isFunction) {
      return { ...node, declarations: node.declarations.map((d) => ({ ...d, init: d.init ? this.expr(d.init, scope) : null })) };
    }
    // Timeline-level "var x = v" defines a timeline variable.
    const assigns = node.declarations
      .filter((d) => d.init)
      .map((d) => ({ type: 'AssignmentExpression', operator: '=', left: member(SCOPE, id(d.id.name)), right: this.expr(d.init, scope) }));
    if (inFor) return assigns.length ? { type: 'SequenceExpression', expressions: assigns } : null;
    if (!assigns.length) return null;
    return { type: 'ExpressionStatement', expression: assigns.length === 1 ? assigns[0] : { type: 'SequenceExpression', expressions: assigns } };
  }
}

function preprocess(src) {
  let s = replaceWordOps(src);
  // tellTarget(expr) { ... }  ->  with(expr) { ... }  (body uses _X/_Y which target the clip)
  s = s.replace(/\btellTarget\s*\(/g, 'with(');
  return s;
}

/** Translate one AS2 body into the source of a JS function body using "$" as timeline scope. */
export function translateBody(src) {
  const code = preprocess(src);
  const ast = acorn.parse(code, { ecmaVersion: 2020, sourceType: 'script', allowReturnOutsideFunction: true });
  const t = new Translator();
  const top = new Scope(null, new Set(), false);
  const body = t.stmts(ast.body, top);
  return generate({ type: 'Program', body, sourceType: 'script' });
}
