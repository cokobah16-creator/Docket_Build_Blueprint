// What a person reads when something they did was not saved.
//
// Postgres and PostgREST speak to developers: "new row violates row-level
// security policy", "slot unavailable", "duplicate key value violates unique
// constraint". None of that belongs in front of a client. This turns an error
// into a sentence that says what was not done, whether anything was saved, and
// what to do next — and hands the technical detail to error reporting, where
// the people who can act on it will see it.
//
// Server-only: captureException reads a server secret.

import { captureException } from "@/lib/observability";
import { userErrorMessage, type DbErrorLike } from "@/lib/user-error-message";

export { userErrorMessage };

/** Report the technical detail and return the human sentence. Never throws. */
export async function userError(error: unknown, what: string, where: string): Promise<string> {
  try {
    const e = (error ?? {}) as DbErrorLike;
    await captureException(error instanceof Error ? error : new Error(e.message ?? String(error)), {
      where,
      tags: e.code ? { code: e.code } : undefined,
    });
  } catch {
    /* reporting must never turn one failure into two */
  }
  return userErrorMessage(error, what);
}
