// Rewrites Tailwind's gray-* bridge classes to the semantic tokens, and the
// 32 ad-hoc type sizes to the ramp. Run from the repo root:
//
//   node scripts/codemod-classes.mjs --dry     # report only
//   node scripts/codemod-classes.mjs           # apply
//   node scripts/codemod-classes.mjs --only text   # just the type ramp
//
// Safety rules, each earned from something in this repo:
//   * a replacement only fires inside a string that already looks like a class
//     list, so prose and comments are never touched
//   * variant prefixes survive: hover:, focus:, md:, group-hover:, first: ...
//   * longest match first, so border-gray-300 is not eaten by a gray-300 rule
//   * bg-white uses a negative lookahead for / and [ — the video call surface
//     carries ten translucent bg-white/[0.12] overlays that must not move
//   * an explicit exception list for lines that are deliberately as they are
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const COLOUR = [
  ['bg-white',        'bg-raised',        '(?![/\\[\\w-])'],
  ['bg-gray-50',      'bg-sunken'],
  ['bg-gray-100',     'bg-sunken'],
  ['bg-gray-200',     'bg-hairline'],
  ['text-gray-900',   'text-ink'],
  ['text-gray-800',   'text-ink'],
  ['text-gray-700',   'text-ink'],
  ['text-gray-600',   'text-ink-muted'],
  ['text-gray-500',   'text-ink-muted'],
  ['text-gray-400',   'text-ink-muted'],
  ['border-gray-400', 'border-edge'],
  ['border-gray-300', 'border-edge'],
  ['border-gray-200', 'border-hairline'],
  ['border-gray-100', 'border-hairline'],
  ['divide-gray-100', 'divide-hairline'],
  ['divide-gray-200', 'divide-hairline'],
  ['placeholder:text-gray-400', 'placeholder:text-ink-muted'],
  ['placeholder:text-gray-500', 'placeholder:text-ink-muted'],
  // A black wash is invisible on a dark ground. bg-hover is ink at 5% alpha,
  // and ink is near-white in dark, so the overlay flips with the theme.
  ['bg-black/5',  'bg-hover'],
  ['bg-black/10', 'bg-press'],
];

// 16px is missing on purpose: it is where inputs live, and it is a platform
// constraint rather than a typographic step, so it is not on the ramp.
const TEXT = [
  [['text-[9.5px]','text-[10px]','text-[10.5px]','text-[11px]','text-[11.5px]'], 'text-11'],
  [['text-xs','text-[12px]','text-[12.5px]','text-[13px]','text-[13.5px]'],      'text-13'],
  [['text-sm','text-[14px]','text-[14.5px]','text-[15px]'],                      'text-15'],
  [['text-[15.5px]','text-[17px]','text-lg'],                                    'text-17'],
  [['text-xl','text-[20px]','text-[21px]','text-[22px]','text-[23px]'],          'text-21'],
  [['text-2xl','text-[26px]'],                                                   'text-26'],
  [['text-[34px]'],                                                              'text-32'],
  [['text-3xl','text-4xl','text-[44px]'],                                        'text-44'],
  [['text-5xl','text-[56px]'],                                                   'text-56'],
  [['text-[88px]'],                                                              'text-88'],
];

const RADIUS = [
  ['rounded-[9px]',  'rounded-control'],
  ['rounded-[10px]', 'rounded-control'],
  ['rounded-[11px]', 'rounded-control'],
  ['rounded-t-[18px]','rounded-t-sheet'],
];

// Lines that are right as they are. Matched on content, not number, so an
// unrelated edit above cannot silently un-except them.
const KEEP = [
  { file: 'src/components/video/consultation-room.tsx',
    contains: 'bg-white text-[#0B0B0C]',
    why: 'a white Admit button sitting on the dark call surface; it must stay white' },
  { file: 'src/components/ui/switch.tsx',
    contains: 'size-[22px] rounded-full bg-white',
    why: "the switch knob is an object rather than a surface, and it has to read against an arbitrary firm's brand colour on one side of the track; bg-raised is a dark grey in dark mode and would sink into a dark brand the moment the switch was turned on" },
];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One rule, applied so that any variant prefix in front of it survives. */
function rule(kind, from, to, tail = '(?![\\w-])') {
  return {
    kind, from, to,
    re: new RegExp(`(^|[\\s"'\`])((?:[a-z-]+:)*)${esc(from)}${tail}`, 'g'),
    sub: (_m, lead, variants) => `${lead}${variants}${to}`,
  };
}

const RULES = [];
if (!ONLY || ONLY === 'colour') for (const [f, t, tail] of COLOUR) RULES.push(rule('colour', f, t, tail));
if (!ONLY || ONLY === 'text')   for (const [froms, t] of TEXT) for (const f of froms) RULES.push(rule('text', f, t));
if (!ONLY || ONLY === 'radius') for (const [f, t] of RADIUS) RULES.push(rule('radius', f, t));
// Longest source first so a shorter rule cannot eat a longer one's prefix.
RULES.sort((a, b) => b.from.length - a.from.length);

// WHY A FONT SIZE IS NEVER REWRITTEN INSIDE A FORM CONTROL
//
// The ramp has no 16px step, deliberately: 16 is where inputs live, and it is a
// platform constraint rather than a typographic choice — a real input under 16px
// makes iOS Safari zoom the whole page on focus.
//
// So mapping an input's `text-sm` to `text-15` would leave it zooming at 15px
// while giving it a class that reads as a considered ramp step. That is worse
// than leaving it alone: the bug stops looking like one. Colour and radius still
// apply inside these tags; only the type rules are held, and every size held
// back is printed, so a clean run never implies they were looked at and approved.
//
// The scan tracks quotes and braces because a JSX attribute value routinely
// contains both — className={`… ${x} …`} — and a naive search for the next '>'
// would end the tag in the middle of one.
function formControlMask(src) {
  const mask = new Uint8Array(src.length);
  const open = /<(input|textarea|select)\b/g;
  let m;
  while ((m = open.exec(src))) {
    let i = m.index, depth = 0, quote = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth <= 0) break;
    }
    const tag = src.slice(m.index, Math.min(i + 1, src.length));
    // A file picker, a checkbox or a submit button has no typing surface, so its
    // font size styles a label and is an ordinary ramp candidate. Only a control
    // a person types into is held back.
    if (!/type=["']?(file|checkbox|radio|color|range|hidden|submit|button|image|reset)\b/.test(tag)) {
      mask.fill(1, m.index, Math.min(i + 1, src.length));
    }
    open.lastIndex = i;
  }
  return mask;
}

/** Split a line into runs that are inside a form-control tag and runs that are not. */
function segments(line, mask, from) {
  const out = [];
  let start = 0;
  for (let i = 1; i <= line.length; i++) {
    if (i === line.length || mask[from + i] !== mask[from + start]) {
      out.push({ text: line.slice(start, i), inControl: mask[from + start] === 1 });
      start = i;
    }
  }
  return out.length ? out : [{ text: line, inControl: false }];
}

const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p); }
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) files.push(p);
  }
}
walk('app'); walk('src');

let totalFiles = 0, totalHits = 0, skipped = 0;
const perRule = new Map();
const held = [];

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  const keeps = KEEP.filter(k => file.endsWith(k.file));
  const mask = formControlMask(before);
  const lines = before.split('\n');
  let changed = 0;
  let at = 0;

  const after = lines.map((line, lineNo) => {
    const from = at;
    at += line.length + 1;
    if (keeps.some(k => line.includes(k.contains))) { skipped++; return line; }
    // Only touch a line that actually carries a class list.
    if (!/class(Name)?\s*=|^\s*(const|let|var)\s|["'`][^"'`]*\b(bg|text|border|rounded|divide|hover|focus|md|lg|sm):?-/.test(line)) return line;

    const apply = (text, inControl) => {
      let out = text;
      for (const r of RULES) {
        if (inControl && r.kind === 'text') {
          r.re.lastIndex = 0;
          const n = (out.match(r.re) || []).length;
          if (n) held.push({ file, line: lineNo + 1, from: r.from, would: r.to });
          continue;
        }
        r.re.lastIndex = 0;
        const n = (out.match(r.re) || []).length;
        if (n) { out = out.replace(r.re, r.sub); changed += n; perRule.set(r.from, (perRule.get(r.from) || 0) + n); }
      }
      return out;
    };

    // The common case is a line with no form control on it at all; segmenting
    // every line would only make the regexes run against smaller pieces and risk
    // a match that straddles a boundary.
    let anyControl = false;
    for (let i = 0; i < line.length; i++) if (mask[from + i]) { anyControl = true; break; }
    if (!anyControl) return apply(line, false);
    return segments(line, mask, from).map(seg => apply(seg.text, seg.inControl)).join('');
  }).join('\n');

  if (after !== before) {
    totalFiles++; totalHits += changed;
    if (!DRY) fs.writeFileSync(file, after);
  }
}

console.log(`${DRY ? 'WOULD REWRITE' : 'rewrote'} ${totalHits} classes across ${totalFiles} files`);
if (skipped) console.log(`${skipped} line(s) left alone by the exception list:`);
for (const k of KEEP) console.log(`    ${k.file} — ${k.why}`);

if (held.length) {
  console.log(`\n${held.length} font size(s) held back inside a control a person types into —`);
  console.log('the ramp has no 16px step, so a rewrite would relabel a field that still zooms on iOS:');
  for (const h of held) console.log(`    ${h.file}:${h.line}  ${h.from} (would have become ${h.would})`);
  console.log('    Set these to text-base rather than a ramp step. See src/components/ui/input.tsx.');
}
console.log('\nby rule:');
for (const [from, n] of [...perRule].sort((a, b) => b[1] - a[1])) {
  const to = RULES.find(r => r.from === from).to;
  console.log(`  ${String(n).padStart(4)}  ${from.padEnd(28)} -> ${to}`);
}
