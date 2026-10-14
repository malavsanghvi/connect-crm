// A switch that needs no deploy: setting localStorage "niva.off" to "1" in a browser makes Niva's whole interface render nothing
// there (support can ask a person to run localStorage.setItem("niva.off", "1") if it ever misbehaves). Read inside try/catch because
// storage can be missing, blocked or throw (private windows, blocked site data).

export const KILL_KEY = "niva.off";

type Reader = Pick<Storage, "getItem">;

/** True when this browser has been told to hide Niva. Never throws. `storage` is for tests; by default the browser's own. */
export function nivaSwitchedOffHere(storage?: Reader | null): boolean {
  try {
    const store = storage !== undefined ? storage : typeof localStorage === "undefined" ? null : localStorage;
    return store?.getItem(KILL_KEY) === "1";
  } catch {
    return false;
  }
}
