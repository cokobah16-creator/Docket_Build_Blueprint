"use client";

// Court picker for the post-court-update form and anywhere else a matter has
// to point at a registry. Nigeria has hundreds of divisions, so the list
// narrows by level, then state, then a division/name search — three taps on a
// phone rather than a scroll through everything.
//
// Rule enforced: "Add our own court" is the only court write staff may make —
// the courts policy accepts an insert only when firm_id is this firm and
// created_by is the signed-in user, so both are set from the session, never
// from a prop alone. The id is generated here and the insert returns nothing,
// because the select policy cannot see a row inserted by the same statement.

import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { COURT_LEVEL_LABELS, NG_STATES, NG_STATE_OPTIONS } from "@/lib/nigeria";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { CourtRow } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";
const MAX_SHOWN = 30;

function courtLine(c: CourtRow): string {
  const where = [c.division, c.city].filter(Boolean).join(", ");
  return where ? `${c.name} — ${where}` : c.name;
}

export function CourtPicker({
  courts,
  firmId,
  value,
  onChange,
  label = "Court",
}: {
  courts: CourtRow[];
  firmId: string;
  value: string | null;
  onChange: (courtId: string | null, court: CourtRow | null) => void;
  label?: string;
}) {
  // Courts added here are not in the server-rendered list until the page refreshes.
  const [added, setAdded] = useState<CourtRow[]>([]);
  const all = useMemo(() => [...added, ...courts], [added, courts]);
  const selected = value ? all.find((c) => c.id === value) ?? null : null;

  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState("");
  const [state, setState] = useState("");
  const [query, setQuery] = useState("");

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    level: "", name: "", short_name: "", state_code: "", division: "", city: "", suit_number_hint: "",
  });

  const levels = useMemo(() => {
    const present = new Set(all.map((c) => c.level));
    return Object.entries(COURT_LEVEL_LABELS).filter(([key]) => present.has(key as CourtRow["level"]));
  }, [all]);

  const states = useMemo(() => {
    const present = new Set(all.filter((c) => !level || c.level === level).map((c) => c.state_code).filter(Boolean));
    return NG_STATE_OPTIONS.filter((s) => present.has(s.code));
  }, [all, level]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((c) => {
      if (level && c.level !== level) return false;
      if (state && c.state_code !== state) return false;
      if (!q) return true;
      return [c.name, c.short_name, c.division, c.city, c.suit_number_hint]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [all, level, state, query]);

  function choose(court: CourtRow | null) {
    onChange(court?.id ?? null, court);
    setOpen(false);
  }

  async function addCourt() {
    setError(null);
    const name = draft.name.trim();
    if (!draft.level) { setError("Choose the level of court."); return; }
    if (name.length < 3) { setError("Give the court's full name as the registry writes it."); return; }

    const supabase = supabaseBrowser();
    if (!supabase) { setError("Not configured."); return; }
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); setError("Your session has expired. Sign in again."); return; }

    const row: CourtRow = {
      id: crypto.randomUUID(),
      firm_id: firmId,
      level: draft.level as CourtRow["level"],
      name,
      short_name: draft.short_name.trim() || null,
      state_code: draft.state_code || null,
      division: draft.division.trim() || null,
      city: draft.city.trim() || null,
      suit_number_hint: draft.suit_number_hint.trim() || null,
      is_active: true,
    };
    // No .select(): the select policy cannot read a row inserted by the same statement.
    const { error: insertError } = await supabase.from("courts").insert({ ...row, created_by: user.id });
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }

    setAdded((prev) => [row, ...prev]);
    setDraft({ level: "", name: "", short_name: "", state_code: "", division: "", city: "", suit_number_hint: "" });
    setAdding(false);
    choose(row);
  }

  return (
    <div>
      <p className="text-sm font-medium text-gray-900">{label}</p>

      {selected && !open && (
        <div className="mt-1 flex flex-wrap items-start justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm text-gray-900">{courtLine(selected)}</p>
            <p className="text-xs text-gray-500">
              {COURT_LEVEL_LABELS[selected.level] ?? selected.level}
              {selected.state_code ? ` · ${NG_STATES[selected.state_code] ?? selected.state_code}` : ""}
              {selected.firm_id ? " · your firm's own entry" : ""}
            </p>
            {selected.suit_number_hint && (
              <p className="mt-1 text-xs text-gray-600">Suit numbers here read like <span className="font-medium">{selected.suit_number_hint}</span></p>
            )}
          </div>
          <button type="button" onClick={() => setOpen(true)} className="shrink-0 text-sm font-medium text-brand underline">
            Change
          </button>
        </div>
      )}

      {value && !selected && !open && (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="text-sm text-gray-700">A court is on this matter but it is not in the directory you can read.</p>
          <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-brand underline">Change</button>
        </div>
      )}

      {open && (
        <div className="mt-1 space-y-2 rounded-lg border border-gray-200 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="cp_level" className="text-xs font-medium text-gray-700">Level</label>
              <select id="cp_level" value={level} onChange={(e) => { setLevel(e.target.value); setState(""); }} className={field}>
                <option value="">Every level</option>
                {levels.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cp_state" className="text-xs font-medium text-gray-700">State</label>
              <select id="cp_state" value={state} onChange={(e) => setState(e.target.value)} className={field}>
                <option value="">Every state</option>
                {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="cp_q" className="text-xs font-medium text-gray-700">Division or name</label>
            <input
              id="cp_q" type="search" inputMode="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Ikeja, Lagos Judicial Division, FHC…" className={field}
            />
          </div>

          {matches.length === 0 ? (
            <p className="px-1 py-2 text-sm text-gray-600">
              No court matches that. Widen the filters, or add the court yourself below.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {matches.slice(0, MAX_SHOWN).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => choose(c)}
                    className={cn(
                      "flex min-h-[44px] w-full flex-col justify-center rounded-lg border px-3 py-2 text-left",
                      c.id === value ? "border-brand bg-brand text-white" : "border-gray-200 bg-white hover:border-brand",
                    )}
                  >
                    <span className="text-sm font-medium">{courtLine(c)}</span>
                    <span className={cn("text-xs", c.id === value ? "text-white/80" : "text-gray-500")}>
                      {COURT_LEVEL_LABELS[c.level] ?? c.level}
                      {c.state_code ? ` · ${NG_STATES[c.state_code] ?? c.state_code}` : ""}
                      {c.firm_id ? " · your firm's own entry" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {matches.length > MAX_SHOWN && (
            <p className="text-xs text-gray-500">{matches.length - MAX_SHOWN} more — narrow the search to see them.</p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-2">
            <button type="button" onClick={() => setAdding((v) => !v)} className="text-sm font-medium text-brand underline">
              {adding ? "Cancel" : "Add our own court"}
            </button>
            {value && (
              <button type="button" onClick={() => choose(null)} className="text-sm text-gray-600 underline">
                Clear the court
              </button>
            )}
            {selected && (
              <button type="button" onClick={() => setOpen(false)} className="ml-auto text-sm text-gray-600 underline">
                Done
              </button>
            )}
          </div>

          {adding && (
            <div className="space-y-2 rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-600">
                Added courts are private to your firm and available on every matter here.
              </p>
              {error && <Alert kind="error">{error}</Alert>}
              <div>
                <label htmlFor="cp_new_level" className="text-xs font-medium text-gray-700">Level</label>
                <select id="cp_new_level" value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })} className={field}>
                  <option value="">Choose a level</option>
                  {Object.entries(COURT_LEVEL_LABELS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="cp_new_name" className="text-xs font-medium text-gray-700">Full name, as the registry writes it</label>
                <input id="cp_new_name" type="text" maxLength={200} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor="cp_new_state" className="text-xs font-medium text-gray-700">State</label>
                  <select id="cp_new_state" value={draft.state_code} onChange={(e) => setDraft({ ...draft, state_code: e.target.value })} className={field}>
                    <option value="">Not tied to a state</option>
                    {NG_STATE_OPTIONS.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="cp_new_division" className="text-xs font-medium text-gray-700">Judicial division / district</label>
                  <input id="cp_new_division" type="text" maxLength={120} value={draft.division} onChange={(e) => setDraft({ ...draft, division: e.target.value })} className={field} />
                </div>
                <div>
                  <label htmlFor="cp_new_city" className="text-xs font-medium text-gray-700">Town</label>
                  <input id="cp_new_city" type="text" maxLength={120} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} className={field} />
                </div>
                <div>
                  <label htmlFor="cp_new_short" className="text-xs font-medium text-gray-700">Short name</label>
                  <input id="cp_new_short" type="text" maxLength={40} value={draft.short_name} onChange={(e) => setDraft({ ...draft, short_name: e.target.value })} className={field} />
                </div>
              </div>
              <div>
                <label htmlFor="cp_new_hint" className="text-xs font-medium text-gray-700">Suit number format (optional)</label>
                <input
                  id="cp_new_hint" type="text" maxLength={80} value={draft.suit_number_hint}
                  onChange={(e) => setDraft({ ...draft, suit_number_hint: e.target.value })}
                  placeholder="FHC/L/CS/123/2026" className={field}
                />
              </div>
              <Button type="button" onClick={addCourt} disabled={busy}>{busy ? "Adding…" : "Add this court"}</Button>
            </div>
          )}
        </div>
      )}

      {!open && !value && (
        <button
          type="button" onClick={() => setOpen(true)}
          className="mt-1 flex min-h-[44px] w-full items-center rounded-lg border border-dashed border-gray-300 px-3 text-sm text-gray-600 hover:border-brand"
        >
          Choose the court
        </button>
      )}
    </div>
  );
}
