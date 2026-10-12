// /people in the New look is either the People home (the find box, the inbox, recent families) or a list of families or people
// with its filters as chips. Any list address keeps showing the list, so every old link and every filter link keeps working.

export type HomeParams = Record<string, string | string[] | undefined>;

/** The addresses that mean "show me a list": filters, a view, a sort, a page, a selected household, the old ask sentence. */
export const LIST_PARAMS = ["q", "zone", "tier", "over", "over_amount", "norsvp", "ending", "view", "sort", "said", "band", "page", "hh", "ask", "bad", "unread"] as const;

/** True when /people has no list address on it: show the People home. */
export function peopleHomeRequested(sp: HomeParams): boolean {
  return LIST_PARAMS.every((k) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s === undefined || s.trim() === "";
  });
}
