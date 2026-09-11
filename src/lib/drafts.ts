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
 */
export function useDeviceDraft<T>(key: string | null, initial: T, empty: (v: T) => boolean): {
  value: T; set: (next: T | ((cur: T) => T)) => void; restored: boolean; clear: () => void;
} {
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const hydrated = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!key || hydrated.current) return;
    hydrated.current = true;
    const saved = readDraft<T>(key);
    if (saved !== null && !empty(saved)) { setValue(saved); setRestored(true); }
  }, [key, empty]);

  const set = useCallback((next: T | ((cur: T) => T)) => {
    setRestored(false);
    setValue((cur) => {
      const v = typeof next === "function" ? (next as (c: T) => T)(cur) : next;
      if (key) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { if (empty(v)) clearDraft(key); else writeDraft(key, v); }, 400);
      }
      return v;
    });
  }, [key, empty]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (key) clearDraft(key);
    setRestored(false);
    setValue(initial);
  }, [key, initial]);

  return { value, set, restored, clear };
}

/** The signed-in person's id, for a draft key, in a component that was not handed it. */
export function useDraftOwner(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setId(data.user?.id ?? null)).catch(() => undefined);
  }, []);
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
