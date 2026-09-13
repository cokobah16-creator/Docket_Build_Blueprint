// What a person typed, kept on this device until it is sent.
//
// A dropped connection, a reload, a tab the phone discarded: the words are still here. Kept in
// localStorage under the signed-in person's id and the thing being written (a court update on a
// matter, a message on a thread, a note), written a moment after each keystroke, restored on
// the next visit with a notice, and cleared only once the write has returned. The login pages
// sweep every draft on this device, so a shared phone keeps nothing across sign-ins. Nothing
// here runs on the server, and nothing here is sent anywhere.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

const PREFIX = "docket:draft:";

export function draftKey(userId: string, target: string): string {
  return `${PREFIX}${userId}:${target}`;
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v: T; at: string };
    return parsed && "v" in parsed ? parsed.v : null;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ v: value, at: new Date().toISOString() }));
  } catch {
    /* storage unavailable: the draft lives in memory only */
  }
}

export function clearDraft(key: string): void {
  try { window.localStorage.removeItem(key); } catch { /* nothing to clear */ }
}

/** Every draft on this device, whoever typed it. Called on the login pages. */
export function clearAllDrafts(): number {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
    return keys.length;
  } catch {
    return 0;
  }
}

/**
 * State that survives the connection: a draft restored on mount (restored=true until the
 * person changes it or it is cleared), written a moment after each change, cleared by the
 * caller once the write returned. `empty` decides whether there is anything worth keeping.
 *
 * `reconcile` is how a form that was server-rendered rescues what was typed into it before
 * React attached. A page is on the glass and accepts keystrokes about a second before its
 * JavaScript arrives, and those keystrokes are in the DOM while this hook's state is still
 * the initial value — so restoring a saved draft over the top of them, or letting React's
 * first render win, throws away words the person watched themselves type. The hook calls
 * `reconcile` once, inside the same effect that reads storage, and whatever it returns is
 * what the form starts from. Doing it here rather than in a second effect is the point:
 * two effects would race, and the loser's words would be the ones lost.
 */
export function useDeviceDraft<T>(
  key: string | null,
  initial: T,
  empty: (v: T) => boolean,
  reconcile?: (saved: T | null) => T | null,
): {
  value: T; set: (next: T | ((cur: T) => T)) => void; restored: boolean; clear: () => void;
} {
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const hydrated = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // These three arrive as fresh closures on every render. Held in refs, they stop the
  // restore effect re-running on each one and stop `set` and `clear` changing identity
  // for reasons that have nothing to do with the draft.
  const emptyRef = useRef(empty);
  const initialRef = useRef(initial);
  const reconcileRef = useRef(reconcile);
  emptyRef.current = empty;
  initialRef.current = initial;
  reconcileRef.current = reconcile;

  useEffect(() => {
    if (!key || hydrated.current) return;
    hydrated.current = true;
    const found = readDraft<T>(key);
    const saved = found !== null && !emptyRef.current(found) ? found : null;
    const start = reconcileRef.current ? reconcileRef.current(saved) : saved;
    if (start === null || emptyRef.current(start)) return;
    setValue(start);
    // "Restored" means these words came back from storage, which is worth saying. Words
    // the person typed a second ago need no announcement, so early input alone is silent.
    setRestored(saved !== null);
    // Write immediately rather than waiting for the next keystroke: if the tab is closed
    // now, anything rescued from the pre-hydration DOM would otherwise never be kept.
    writeDraft(key, start);
  }, [key]);

  const set = useCallback((next: T | ((cur: T) => T)) => {
    setRestored(false);
    setValue((cur) => {
      const v = typeof next === "function" ? (next as (c: T) => T)(cur) : next;
      if (key) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { if (emptyRef.current(v)) clearDraft(key); else writeDraft(key, v); }, 400);
      }
      return v;
    });
  }, [key]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (key) clearDraft(key);
    setRestored(false);
    setValue(initialRef.current);
  }, [key]);

  return { value, set, restored, clear };
}

/**
 * The signed-in person's id, for a draft key, in a component that was not handed it.
 *
 * getSession() and not getUser(): getUser() is a round trip to /auth/v1/user, and this id is
 * what the draft key is built from — so on the one occasion the draft exists for, a connection
 * that has already dropped, the round trip fails, the key stays null and nothing is kept, while
 * the form goes on saying that what you type is kept on this device. getSession() reads the
 * token the browser already holds. A caller that knows the id should pass it instead: `given`
 * short-circuits this entirely.
 */
export function useDraftOwner(given?: string | null): string | null {
  const [id, setId] = useState<string | null>(given ?? null);
  useEffect(() => {
    if (given) { setId(given); return; }
    const supabase = supabaseBrowser();
    if (!supabase) return;
    supabase.auth.getSession()
      .then(({ data }) => setId(data.session?.user?.id ?? null))
      .catch(() => undefined);
  }, [given]);
  return id;
}

/**
 * An upload in progress: the ids minted for it, so the same file chosen again after a drop
 * finishes the same document instead of starting a second one. One per person and target.
 */
export interface UploadInProgress { name: string; size: number; documentId: string; versionId: string; storagePath: string }
export function uploadKey(userId: string | null | undefined, target: string): string {
  return `${PREFIX}${userId ?? "anon"}:upload:${target}`;
}
/** Storage's own words for "these bytes are already there" — the upload had in fact finished. */
export function isAlreadyStored(message: string | undefined): boolean {
  return /already exists|duplicate|409/i.test(message ?? "");
}
export const UPLOAD_STOPPED = "The upload stopped — the connection dropped. Choose the same file again to finish it, or remove the entry.";

/** The one sentence for a send that never reached the server. */
export const NOT_SENT = "Not sent — the connection dropped. What you typed is kept on this device; try again when you are back online.";

/** True when a thrown server-action error is the network, not the database. */
export function isNetworkFailure(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /fetch|network|Failed to|NetworkError|Load failed|timeout|ECONN|offline/i.test(msg);
}
