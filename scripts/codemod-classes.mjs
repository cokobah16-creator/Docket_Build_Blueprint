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
];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One rule, applied so that any variant prefix in front of it survives. */
function rule(from, to, tail = '(?![\\w-])') {
  return {
    from, to,
    re: new RegExp(`(^|[\\s"'\`])((?:[a-z-]+:)*)${esc(from)}${tail}`, 'g'),
    sub: (_m, lead, variants) => `${lead}${variants}${to}`,
  };
}

const RULES = [];
if (!ONLY || ONLY === 'colour') for (const [f, t, tail] of COLOUR) RULES.push(rule(f, t, tail));
if (!ONLY || ONLY === 'text')   for (const [froms, t] of TEXT) for (const f of froms) RULES.push(rule(f, t));
if (!ONLY || ONLY === 'radius') for (const [f, t] of RADIUS) RULES.push(rule(f, t));
// Longest source first so a shorter rule cannot eat a longer one's prefix.
RULES.sort((a, b) => b.from.length - a.from.length);

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

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  const keeps = KEEP.filter(k => file.endsWith(k.file));
  const lines = before.split('\n');
  let changed = 0;

  const after = lines.map(line => {
    if (keeps.some(k => line.includes(k.contains))) { skipped++; return line; }
    // Only touch a line that actually carries a class list.
    if (!/class(Name)?\s*=|^\s*(const|let|var)\s|["'`][^"'`]*\b(bg|text|border|rounded|divide|hover|focus|md|lg|sm):?-/.test(line)) return line;
    let out = line;
    for (const r of RULES) {
      r.re.lastIndex = 0;
      const n = (out.match(r.re) || []).length;
      if (n) { out = out.replace(r.re, r.sub); changed += n; perRule.set(r.from, (perRule.get(r.from) || 0) + n); }
    }
    return out;
  }).join('\n');

  if (after !== before) {
    totalFiles++; totalHits += changed;
    if (!DRY) fs.writeFileSync(file, after);
  }
}

console.log(`${DRY ? 'WOULD REWRITE' : 'rewrote'} ${totalHits} classes across ${totalFiles} files`);
if (skipped) console.log(`${skipped} line(s) left alone by the exception list:`);
for (const k of KEEP) console.log(`    ${k.file} — ${k.why}`);
console.log('\nby rule:');
for (const [from, n] of [...perRule].sort((a, b) => b[1] - a[1])) {
  const to = RULES.find(r => r.from === from).to;
  console.log(`  ${String(n).padStart(4)}  ${from.padEnd(28)} -> ${to}`);
}
