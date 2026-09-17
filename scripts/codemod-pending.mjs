// Moves every in-flight <Button> from `disabled={busy}` to `pending={busy}`.
//
//   node scripts/codemod-pending.mjs --dry          # the decision table, nothing written
//   node scripts/codemod-pending.mjs                # apply
//   node scripts/codemod-pending.mjs --only C       # one class (A, B, B', C)
//
// WHY. button.tsx's `pending` marks the control aria-disabled rather than
// `disabled`, so focus stays where the person left it and aria-busy is on an
// element a screen reader still reports. `disabled` moves focus to <body> in
// every browser and the announcement reaches nobody. The prop landed; 138 call
// sites went on writing `disabled={busy}`, so the fix reached the component and
// not one user.
//
// It also collapses the label swap — `{busy ? "Saving…" : "Save"}` — to the
// ordinary label, because `pending` already draws a spinner beside it and one
// affordance on every button beats fourteen wordings on some of them.
//
// FOUR SHAPES, and the script refuses anything else:
//   A   disabled={busy}                 -> pending={busy}
//   B   disabled={busy === s.id}        -> pending={busy === s.id}
//   B'  disabled={busy !== null}        -> pending={busy === KEY} disabled={busy !== null && busy !== KEY}
//       where KEY is read from the label swap {busy === KEY ? …}; with no swap
//       there is no key, the button is not the busy one, and it stays disabled.
//   C   disabled={busy || !valid}       -> pending={busy} disabled={!valid}
//       split on the top-level || only; a && with a flag in it is one B.
//   D   disabled={!valid}               -> untouched (no in-flight name in it)
//   E   {busy ? "Serving…" : "Serve"}   -> pending={busy}, whether disabled is validation-only or absent:
//       the label swap is the tell, exactly as it is for B'. Collapsing the swap without
//       adding pending= would leave the button with no in-flight signal at all.
//
// The reads are brace- and quote-aware because a disabled expression in this
// tree contains `busy === \`note:${r.id}\``, and a naive scan for the closing
// brace ends inside the template literal.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

// The in-flight names actually declared in the tree — every useState/useTransition
// that means "a request is out". Not a guess at a vocabulary.
const FLAGS = ['busy','pending','saving','working','closing','discarding','deleting','inviting',
  'submitting','checking','savingWeek','addingException','accessBusy','askBusy','genBusy',
  'removing','running','loading','rowBusy','searching'];
const FLAG_RE = new RegExp(`^(?:${FLAGS.join('|')})$`);

// --- scanning ---------------------------------------------------------------

/**
 * Index just past the `}` that closes the `{` at src[open]. Strings of every kind
 * are handed to skipString, so a template literal nested inside another one's
 * `${}` is one string to this function — the earlier version kept its own
 * template stack and popped it on the wrong condition, and returned -1 on
 * `{busy ? "…" : `Issue now${x ? ` · ${y}` : ""}`}`, which is in this tree.
 */
function closeBrace(src, open) {
  let depth = 0, i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return -1;
}

/**
 * Index just past the string literal that opens at src[i]. A template literal can
 * hold `${ … }` and that can hold another template — `Issue now${x ? ` · ${y}` : ""}`
 * is in this tree — so a backtick is only the end when no ${} is open.
 */
function skipString(src, i) {
  const q = src[i]; i++;
  if (q !== '`') { while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } return i + 1; }
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (depth === 0 && c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
    if (depth > 0 && (c === '"' || c === "'" || c === '`')) { i = skipString(src, i); continue; }
    if (depth > 0 && c === '{') depth++;
    if (depth > 0 && c === '}') depth--;
    i++;
  }
  return i;
}

/** Split an expression on a top-level binary operator (`||` or `&&`). */
function splitTop(expr, op) {
  const parts = []; let depth = 0, start = 0, i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(expr, i); continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && expr.startsWith(op, i)) { parts.push(expr.slice(start, i).trim()); i += op.length; start = i; continue; }
    i++;
  }
  parts.push(expr.slice(start).trim());
  return parts;
}

/** The first top-level `?` and its matching `:` inside a ternary body. */
function ternaryParts(expr) {
  let depth = 0, q = -1, i = 0;
  const skipStr = () => { i = skipString(expr, i); };
  while (i < expr.length) {
    const c = expr[i];
    if (c === '"' || c === "'" || c === '`') { skipStr(); continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && c === '?' && expr[i + 1] !== '?' && expr[i + 1] !== '.') { q = i; break; }
    i++;
  }
  if (q < 0) return null;
  // the matching ':' is the first top-level ':' after q, skipping nested ternaries
  let nested = 0; depth = 0; i = q + 1;
  while (i < expr.length) {
    const c = expr[i];
    if (c === '"' || c === "'" || c === '`') { skipStr(); continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && c === '?' && expr[i + 1] !== '?' && expr[i + 1] !== '.') nested++;
    else if (depth === 0 && c === ':') { if (nested === 0) return { cond: expr.slice(0, q).trim(), then: expr.slice(q + 1, i).trim(), else: expr.slice(i + 1).trim() }; nested--; }
    i++;
  }
  return null;
}

// --- classification ---------------------------------------------------------

const norm = s => s.replace(/\s+/g, ' ').trim();

/** Is this operand, on its own, an in-flight test? Returns its shape or null. */
function flagShape(e) {
  e = norm(e);
  if (FLAG_RE.test(e)) return 'A';
  let m = e.match(/^Boolean\((\w+)\)$/); if (m && FLAG_RE.test(m[1])) return 'A';
  if (/^(state|phase) === "(busy|running|connecting)"$/.test(e)) return 'A';
  m = e.match(/^(\w+) === (.+)$/); if (m && FLAG_RE.test(m[1])) return 'B';
  m = e.match(/^(\w+) !== (null|undefined)$/); if (m && FLAG_RE.test(m[1])) return "B'";
  // `removing && removingId === e.id` — a conjunction with a flag in it is "this row is busy"
  const ands = splitTop(e, '&&');
  if (ands.length > 1 && ands.some(a => flagShape(a) === 'A')) return 'B';
  return null;
}

function mentionsFlag(e) { return FLAGS.some(f => new RegExp(`\\b${f}\\b`).test(e)); }

/**
 * Decide what to do with one disabled expression, given the button's children.
 * Returns { cls, pending, disabled } or { cls: 'D' } or throws for a shape it does not know.
 */
function classify(expr, children) {
  const e = norm(expr);
  const shape = flagShape(e);
  if (shape === 'A' || shape === 'B') return { cls: shape, pending: e, disabled: null };
  if (shape === "B'") {
    const flag = e.match(/^(\w+)/)[1];
    const key = keyFromChildren(children, flag);
    if (!key) return { cls: "B'", pending: null, disabled: e, note: 'no label key — a sibling is busy, this one stays disabled' };
    return { cls: "B'", pending: `${flag} === ${key}`, disabled: `${flag} !== null && ${flag} !== ${key}` };
  }
  const ors = splitTop(e, '||');
  if (ors.length > 1) {
    const flags = ors.filter(o => flagShape(o));
    const rest = ors.filter(o => !flagShape(o));
    if (flags.length === 1 && rest.length >= 1) {
      // a B' operand inside a compound behaves as B' would alone
      const f = flags[0], fshape = flagShape(f);
      if (fshape === "B'") {
        const flag = norm(f).match(/^(\w+)/)[1];
        const key = keyFromChildren(children, flag);
        if (!key) return { cls: 'D', note: 'B\' with no key inside a compound; untouched' };
        return { cls: 'C', pending: `${flag} === ${key}`, disabled: `${flag} !== null && ${flag} !== ${key} || ${rest.join(' || ')}` };
      }
      return { cls: 'C', pending: norm(f), disabled: rest.join(' || ') };
    }
    if (flags.length > 1) {
      // Two in-flight operands. The label swap says which one is THIS button's —
      // `{discarding ? "Discarding…" : …}` — and the other is a sibling's, which
      // disables this button the way B' does. With no swap there is nothing to
      // choose on, so refuse rather than guess.
      const mine = flags.find(f => ternariesIn(children).some(t => norm(t.cond) === norm(f)));
      if (!mine) throw new Error(`two in-flight operands and no label to say which is this button's: ${e}`);
      const others = flags.filter(f => f !== mine);
      return { cls: 'C', pending: norm(mine), disabled: [...others, ...rest].join(' || '), note: `sibling flag ${others.map(norm).join(', ')} kept in disabled` };
    }
  }
  if (!mentionsFlag(e)) return { cls: 'D' };
  throw new Error(`in-flight name in a shape the script does not know: ${e}`);
}

/** In `{busy === KEY ? "Installing…" : …}` inside the children, the KEY. */
function keyFromChildren(children, flag) {
  for (const t of ternariesIn(children)) {
    const m = norm(t.cond).match(new RegExp(`^${flag} === (.+)$`));
    if (m) return m[1];
  }
  return null;
}

/** Every top-level `{ … ? … : … }` in a children string, with offsets. */
function ternariesIn(children) {
  const out = [];
  let i = 0;
  while (i < children.length) {
    if (children[i] === '{') {
      const end = closeBrace(children, i);
      if (end < 0) break;
      const inner = children.slice(i + 1, end - 1);
      const t = ternaryParts(inner);
      if (t) out.push({ start: i, end, ...t });
      i = end; continue;
    }
    i++;
  }
  return out;
}

/** Collapse every flag-conditioned ternary in the children to its else-branch. */
function collapseLabels(children) {
  let out = children, changed = 0;
  // right to left so earlier offsets stay valid
  for (const t of ternariesIn(children).reverse()) {
    if (!flagShape(t.cond)) continue;
    const els = t.else.trim();
    const lit = els.match(/^"([^"]*)"$/) || els.match(/^'([^']*)'$/);
    const repl = lit ? lit[1] : `{${els}}`;
    out = out.slice(0, t.start) + repl + out.slice(t.end);
    changed++;
  }
  return { out, changed };
}

// --- the walk ---------------------------------------------------------------

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p); }
    else if (e.name.endsWith('.tsx')) files.push(p);
  }
})('app');
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.tsx')) files.push(p);
  }
})('src');

const rows = [], untouched = [], refused = [];
let filesChanged = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  let out = '', last = 0, changedHere = 0;
  const open = /<Button\b/g;
  let m;
  while ((m = open.exec(src))) {
    // end of the opening tag: first '>' outside braces/quotes
    let i = m.index, depth = 0, selfClosing = false;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') { i = closeBrace(src, i) - 1; continue; }
      if (c === '"' || c === "'") { const q = c; i++; while (i < src.length && src[i] !== q) i++; continue; }
      if (c === '/' && src[i + 1] === '>') { selfClosing = true; i += 1; break; }
      if (c === '>') break;
    }
    const tagEnd = i + 1;
    const tag = src.slice(m.index, tagEnd);
    // Already migrated. Without this a second run reads the sibling flag a C split
    // left in `disabled=` and writes a second pending= beside the first.
    let children = '', childEnd = tagEnd;
    if (!selfClosing) { const c = src.indexOf('</Button>', tagEnd); children = src.slice(tagEnd, c); childEnd = c; }

    if (/\bpending=\{/.test(tag)) {
      const { out: newChildren, changed: collapsed } = collapseLabels(children);
      if (collapsed) {
        const line = src.slice(0, m.index).split('\n').length;
        rows.push({ file, line, cls: 'L', before: '(already pending=)', after: '(label only)', collapsed, note: 'a swap the first pass could not parse' });
        out += src.slice(last, tagEnd) + newChildren; last = childEnd; changedHere++;
      }
      open.lastIndex = tagEnd; continue;
    }

    const d = tag.indexOf('disabled={');
    if (d < 0) {
      // (b) No in-flight disabled at all, but the label swaps on a flag —
      // `{busy ? "Serving…" : "Serve"}` on a button whose disabled is pure
      // validation, or has none. The swap is the tell, exactly as it is for B':
      // its condition is the flag this button is pending on. Collapsing the swap
      // without adding pending= would leave the button with no in-flight signal
      // at all, which is worse than the swap it started with.
      const t = ternariesIn(children).find(t => flagShape(t.cond));
      if (!t) { open.lastIndex = tagEnd; continue; }
      const line = src.slice(0, m.index).split('\n').length;
      if (ONLY && ONLY !== 'E') { open.lastIndex = tagEnd; continue; }
      const { out: newChildren, changed: collapsed } = collapseLabels(children);
      const insertAt = tagEnd - (selfClosing ? 2 : 1);
      const attr = ` pending={${norm(t.cond)}}`;
      rows.push({ file, line, cls: 'E', before: '(no in-flight disabled)', after: `pending={${norm(t.cond)}}`, collapsed, note: 'pending read from the label swap' });
      out += src.slice(last, insertAt) + attr + src.slice(insertAt, tagEnd) + newChildren;
      last = childEnd; changedHere++; open.lastIndex = tagEnd; continue;
    }
    const braceOpen = m.index + d + 'disabled='.length;
    const braceClose = closeBrace(src, braceOpen);
    const expr = src.slice(braceOpen + 1, braceClose - 1);

    const line = src.slice(0, m.index).split('\n').length;
    let verdict;
    try { verdict = classify(expr, children); }
    catch (err) { refused.push(`${file}:${line}  ${err.message}`); open.lastIndex = tagEnd; continue; }

    if (verdict.cls === 'D') {
      const t = ternariesIn(children).find(t => flagShape(t.cond));
      if (t) verdict = { cls: 'E', pending: norm(t.cond), disabled: norm(expr), note: 'pending read from the label swap; validation kept in disabled' };
    }
    if (verdict.cls === 'D') { untouched.push(`${file}:${line}  disabled={${norm(expr)}}${verdict.note ? '  — ' + verdict.note : ''}`); open.lastIndex = tagEnd; continue; }
    if (ONLY && verdict.cls !== ONLY) { open.lastIndex = tagEnd; continue; }

    // rebuild the attribute
    const before = src.slice(m.index + d, braceClose);
    const attrs = [];
    if (verdict.pending) attrs.push(`pending={${verdict.pending}}`);
    if (verdict.disabled) attrs.push(`disabled={${verdict.disabled}}`);
    const after = attrs.join(' ');
    const { out: newChildren, changed: collapsed } = collapseLabels(children);

    rows.push({ file, line, cls: verdict.cls, before: norm(before), after: norm(after), collapsed, note: verdict.note });

    out += src.slice(last, m.index + d) + after + src.slice(braceClose, tagEnd) + newChildren;
    last = childEnd;
    changedHere++;
    open.lastIndex = tagEnd;
  }
  out += src.slice(last);
  if (changedHere && out !== src) { filesChanged++; if (!DRY) fs.writeFileSync(file, out); }
}

// --- the table --------------------------------------------------------------

const byClass = {};
for (const r of rows) byClass[r.cls] = (byClass[r.cls] || 0) + 1;
console.log(`${DRY ? 'WOULD MIGRATE' : 'migrated'} ${rows.length} <Button> sites across ${filesChanged} files` +
  `  (${Object.entries(byClass).map(([k, v]) => `${k}:${v}`).join('  ')}),  ${rows.reduce((s, r) => s + r.collapsed, 0)} label swaps collapsed\n`);
for (const r of rows) {
  console.log(`  ${r.cls.padEnd(2)} ${(r.file + ':' + r.line).padEnd(66)} ${r.before}`);
  console.log(`     ${''.padEnd(66)} -> ${r.after}${r.collapsed ? `   (${r.collapsed} label${r.collapsed > 1 ? 's' : ''} collapsed)` : ''}${r.note ? `   [${r.note}]` : ''}`);
}
if (untouched.length) { console.log(`\n${untouched.length} left alone — no in-flight name in the expression (class D):`); for (const u of untouched) console.log(`    ${u}`); }
if (refused.length) {
  console.log(`\n${refused.length} REFUSED — a shape this script does not know. Nothing was written for these:`);
  for (const r of refused) console.log(`    ${r}`);
  process.exit(1);
}
