// Low-data mode: a per-device preference (localStorage) — previews and
// images load only when tapped. Read on the client only.
export const LOW_DATA_KEY = "docket:low-data";

export function isLowData(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(LOW_DATA_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLowData(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(LOW_DATA_KEY, "1");
    else window.localStorage.removeItem(LOW_DATA_KEY);
  } catch {
    /* storage unavailable */
  }
}
