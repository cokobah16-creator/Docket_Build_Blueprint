// Checks the Docket mobile prototype against the rules in README.md.
//
//   node design/pwa/verify.mjs
//
// Reads the DCLogic component out of "Docket PWA.dc.html", runs it under a stub
// of the canvas runtime (no browser, no fonts, no support.js), and fails on: a
// shell/frame/firm/screen combination that throws, a `{{ binding }}` in the
// template the component does not return, a stale reference to a removed
// binding, or any of the behaviours below regressing — the malformed chip
// style, the client never being admitted to the call, network quality leaking
// from a saved preference, the saved copy claiming the phone is offline,
// another firm's data surviving a firm switch, or every appointment row
// opening the same appointment.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, 'Docket PWA.dc.html'), 'utf8');

const block = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
if (!block) throw new Error('component script block not found');

// The canvas runtime's base class, reduced to what the component calls.
class DCLogic {
  constructor(props) { this.props = props || {}; }
  setState(patch) {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    Object.assign(this.state, next);
  }
}
const Component = new Function('DCLogic', `${block[1]}\nreturn Component;`)(DCLogic);

const failures = [];
const ok = (cond, msg) => { if (cond) console.log('  ok  ' + msg); else failures.push(msg); };
const fresh = (props = {}) => new Component(props);
const settle = () => new Promise((r) => setTimeout(r, 2800)); // past the 2.6s admission

// ── every screen renders ──────────────────────────────────────────────────────
console.log('render sweep');
const screens = ['home', 'notifs', 'appts', 'appt', 'waiting', 'call', 'ended', 'matters', 'messages', 'profile', 'book', 'pay', 'paid', 'today', 'consults', 'lawAppt', 'lawCall', 'clients', 'me'];
let rendered = 0;
for (const shell of ['client', 'lawyer']) for (const frame of ['ios', 'android']) for (const firmKey of ['ak', 'bc']) for (const screen of screens) {
  const c = fresh();
  Object.assign(c.state, { shell, frame, firmKey, screen });
  try { c.renderVals(); rendered += 1; } catch (e) { failures.push(`render threw for ${shell}/${frame}/${firmKey}/${screen}: ${e.message}`); }
}
ok(rendered === screens.length * 8, `all ${screens.length * 8} shell × frame × firm × screen combinations render`);

// ── template ↔ component ─────────────────────────────────────────────────────
console.log('template bindings');
const template = html.slice(0, html.indexOf('<script type="text/x-dc"'));
const names = new Set([...template.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map((m) => m[1]));
names.delete('true');
const keys = new Set(Object.keys(fresh().renderVals()));
const missing = [...names].filter((n) => !keys.has(n));
ok(missing.length === 0, `every top-level template binding resolves${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
for (const stale of ['{{ offline }}', 'toggleOffline', 'S.offline', 'F.ref', 'F.when', 'AK-0261</span>']) {
  ok(!html.includes(stale), `no stale reference to ${stale}`);
}

// ── chip style is a complete declaration list ────────────────────────────────
console.log('chip style');
{
  const sel = fresh().renderVals().clientTypes.find((c) => c.label === 'Individual').style;
  ok(sel.includes('color:#fff;flex:1;'), 'selected client-type chip is white on brand with flex:1 intact');
  ok(!sel.includes('#ffflex'), "no '#ffflex' concatenation");
}

// ── the client is admitted ───────────────────────────────────────────────────
console.log('admission');
{
  const c = fresh();
  c.renderVals().joinCall();
  let v = c.renderVals();
  ok(v.isCall && v.inLobby && !v.inCall, 'after Join, the client is in the lobby');
  await settle();
  v = c.renderVals();
  ok(v.inCall && v.videoOn && v.callTitle.startsWith('In consultation'), 'after a moment the client is admitted and the in-call surface renders');
  v.endCall();
  v = c.renderVals();
  ok(v.isEnded && c.state.call === 'lobby', 'ending the call resets the lobby for a rejoin');

  const d = fresh();
  d.renderVals().joinCall();
  d.renderVals().back();
  await settle();
  ok(d.state.call === 'lobby' && d.state.screen !== 'call', 'leaving the lobby cancels the admission');
}

// ── network quality is not a preference ──────────────────────────────────────
console.log('network');
{
  const c = fresh();
  c.renderVals().toggleLowData();
  let v = c.renderVals();
  ok(v.netLabel === 'Connection good', 'low-data mode alone does not report a weak connection');
  v.netWeak();
  v = c.renderVals();
  ok(v.netLabel === 'Connection weak' && v.netColor === '#D97706', 'a weak network reports itself');
  v.toggleAudio();
  v = c.renderVals();
  ok(v.netLabel === 'Audio only · connection weak', 'the audio-only label stays honest about the network');
  ok(v.netColor === '#16A34A', 'audio-only on a weak network is the good path');
  v.joinCall();
  await settle();
  ok(c.renderVals().inCall && !c.renderVals().dataWarning, 'an audio-only call on a weak network shows no camera warning');
  c.renderVals().toggleAudio();
  ok(c.renderVals().dataWarning === true, 'a video call on a weak network shows the warning');
  ok(c.renderVals().netWeakBtn !== c.renderVals().netGoodBtn, 'the network control reflects the state');
}

// ── saved copy ≠ offline ─────────────────────────────────────────────────────
console.log('saved copy');
{
  const c = fresh();
  let v = c.renderVals();
  ok(v.offlineAction === 'Save now' && !v.offlineSaved && !v.offlineUnsaved, 'nothing saved and online: no banner');
  v.toggleSaved();
  v = c.renderVals();
  ok(v.offlineAction === 'Remove copy' && v.offlineNote.startsWith('Saved'), 'Save now records a copy');
  ok(!v.offlineSaved && v.netLabel === 'Connection good', 'saving a copy does not take the phone offline');
  v.netOff();
  v = c.renderVals();
  ok(v.offlineSaved && !v.offlineUnsaved, 'offline with a copy shows the saved-copy banner');
  ok(v.netLabel === 'No connection' && v.netColor === '#B42318', 'offline is reported as no connection');
  v.toggleSaved();
  v = c.renderVals();
  ok(!v.offlineSaved && v.offlineUnsaved, 'offline without a copy shows the nothing-saved notice');
}

// ── data follows the firm ────────────────────────────────────────────────────
console.log('firm switch');
{
  const c = fresh();
  let v = c.renderVals();
  ok(v.unreadCount === '3' && v.nextRef === 'AK-0247' && v.bookRef === 'AK-0261', 'Attorneys Klinique data by default');
  v.firmList[1].pick();
  v = c.renderVals();
  ok(v.firmName === 'Bello & Co', 'switched to Bello & Co');
  ok(v.notifications.every((n) => !/AK-|Klinique/.test(n.t + n.b)), 'no Attorneys Klinique notifications under Bello & Co');
  ok(v.documents.every((d) => !/Ikoyi|Occupancy|defendant/.test(d.n)), 'no Attorneys Klinique documents under Bello & Co');
  ok(v.services[0].desc.includes('Bello & Co'), 'the service blurb names the firm on screen');
  ok(v.nextRef === 'BC-0113' && v.bookRef === 'BC-0118' && v.unreadCount === '2', 'references and the unread count follow the firm');
  ok(c.state.appt === 0, 'switching firms resets the selected appointment');
}

// ── every row opens its own appointment ──────────────────────────────────────
console.log('appointment rows');
{
  const c = fresh();
  c.renderVals().goAppts();
  let v = c.renderVals();
  v.appointments[2].pick();
  v = c.renderVals();
  ok(v.isAppt && v.apptRef === 'AK-0198' && v.apptSvc === 'Property & Real Estate' && v.apptMode === 'in person', 'the third row opens the August in-person appointment');
  ok(v.apptIsCompleted && !v.apptIsConfirmed, 'a completed appointment has no waiting-room card and no cancel button');
  ok(v.apptStatus === 'Completed' && v.apptInvoice === 'AK-INV-2026-0152', 'status and invoice belong to that appointment');
  v.back();
  ok(c.renderVals().isAppts, 'back returns to the list');
  c.renderVals().appointments[0].pick();
  v = c.renderVals();
  ok(v.apptIsConfirmed && v.apptRef === 'AK-0247' && v.apptWhen === 'Tuesday, 22 September 2026 at 11:00', 'the first row opens the confirmed one');
  v.goHome();
  c.renderVals().goAppt();
  ok(c.renderVals().apptRef === 'AK-0247', "home's Details opens the next appointment");
}

console.log('');
if (failures.length) {
  console.error('FAILED\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('all checks passed');
