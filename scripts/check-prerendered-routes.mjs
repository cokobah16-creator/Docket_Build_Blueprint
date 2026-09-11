#!/usr/bin/env node
// Does the content security policy still agree with what the build actually prerenders?
//
// WHY THIS EXISTS. src/lib/csp.ts serves a nonce-based script-src to every route except a
// hand-written set of prerendered shells. A page Next.js renders at BUILD time has no request,
// so its inline bootstrap scripts carry no nonce and the strict policy blocks them: the HTML
// arrives, React never hydrates, and every control on the page is dead. Nothing in the source
// says which routes those are — only the route table of a real build does — so the set was
// once wrong by four routes, among them firm registration, TOTP enrolment and the whole
// platform console.
//
// This reads the ○ (Static) column of a build log and fails if a route is prerendered that the
// policy does not know about. The opposite direction is safe and is only reported: a shell that
// has become dynamic gets a nonce and works, it just no longer needs its entry.
//
// Usage:  node scripts/check-prerendered-routes.mjs <build.log>

import { readFileSync } from "node:fs";

const logPath = process.argv[2];
if (!logPath) {
  console.error("usage: node scripts/check-prerendered-routes.mjs <build.log>");
  process.exit(2);
}

// A 404 is served for whatever path was asked for, so the middleware never sees the pathname
// "/_not-found" and no entry in the policy's set could ever match it. Next's built-in 404 is a
// paragraph of static text with no control on it, so a blocked hydration costs a console
// violation and nothing a visitor can see. Give Docket its own not-found screen and make it
// dynamic at the same time, then delete this line.
const EXEMPT = new Set(["/_not-found"]);

const csp = readFileSync(new URL("../src/lib/csp.ts", import.meta.url), "utf8");
const declared = csp.match(/const PRERENDERED_SHELLS = new Set\(\[([^\]]*)\]\)/);
if (!declared) {
  console.error("could not find PRERENDERED_SHELLS in src/lib/csp.ts — has it been renamed?");
  process.exit(2);
}
const shells = new Set([...declared[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));

const log = readFileSync(logPath, "utf8");
// Route table rows look like:  ├ ○ /firm/login   2.31 kB   172 kB
const rows = [...log.matchAll(/^\s*(?:\d\d:\d\d:\d\d\s+)?[┌├└]\s+([○ƒ])\s+(\S+)/gm)];
if (rows.length === 0) {
  console.error("no route table found in the build log — did `next build` get that far?");
  process.exit(2);
}

const staticRoutes = rows.filter(([, mark]) => mark === "○").map(([, , route]) => route);
const dynamicRoutes = new Set(rows.filter(([, m]) => m === "ƒ").map(([, , r]) => r));

const unlisted = staticRoutes.filter((r) => !shells.has(r) && !EXEMPT.has(r));
const nowDynamic = [...shells].filter((r) => dynamicRoutes.has(r));

console.log(`routes in the table: ${rows.length}`);
console.log(`prerendered (○):     ${staticRoutes.join(", ") || "(none)"}`);
console.log(`policy's shells:     ${[...shells].join(", ")}`);
console.log(`exempt:              ${[...EXEMPT].join(", ")}`);

if (nowDynamic.length) {
  console.log(
    `\nnote: ${nowDynamic.join(", ")} ${nowDynamic.length === 1 ? "is" : "are"} no longer ` +
      `prerendered. That is safe — a dynamic route gets a nonce — but the entry in ` +
      `PRERENDERED_SHELLS is now dead and 'unsafe-inline' is being handed out for nothing.`,
  );
}

if (unlisted.length) {
  console.error(
    `\n::error::${unlisted.length} prerendered route(s) the content security policy does not ` +
      `know about: ${unlisted.join(", ")}\n\n` +
      `Each is served script-src 'self' 'nonce-…' while its inline bootstrap scripts carry no\n` +
      `nonce, so React will not hydrate and every control on the page will be dead.\n\n` +
      `The fix is almost always \`export const dynamic = "force-dynamic"\` on the page or its\n` +
      `layout — and it is usually right on the merits anyway, because a page that renders the\n` +
      `same HTML for everybody is a page that is wrong for anybody with a session. Add it to\n` +
      `PRERENDERED_SHELLS in src/lib/csp.ts only if the page renders nothing a person supplied.`,
  );
  process.exit(1);
}

console.log("\nOK — every prerendered route is one the policy accounts for.");
