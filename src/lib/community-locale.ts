// What a community speaks and where it is: the languages it chose in Setup > Profile (preferred first), its country, and the locale
// its dates, times and numbers are written in. One read (app.community_languages, 0685, available to everyone linked to the
// community) so that reminders, newsletters, the website draft and the people screens all write in the community's languages.

import { communityLanguages, communityLocale, countryCode } from "@/lib/languages";
import type { AppSupabase } from "@/lib/supabase/server";

export type CommunityLocale = {
  /** Language codes, preferred first; never empty (English when the community has not chosen or the list could not be read). */
  languages: string[];
  /** False when the list could not be read just now: `languages` is then only English and `note` says so. */
  known: boolean;
  /** One plain sentence for the person when `known` is false, else null. */
  note: string | null;
  /** ISO 3166 alpha-2 ("US", "GB"), or null. */
  country: string | null;
  /** BCP-47 locale for dates, times and numbers ("en-US", "es-MX"). */
  locale: string;
};

/** The pure part: a community's locale from what was read. */
export function localeOf(languages: unknown, country: unknown): CommunityLocale {
  const langs = communityLanguages(Array.isArray(languages) ? languages : null);
  const cc = countryCode(country);
  return { languages: langs, known: true, note: null, country: cc, locale: communityLocale(langs, cc) };
}

const UNREAD = "Weaver could not read which languages this community uses just now, so it is using English only. Try again in a moment.";

/** Reads the community's languages. Never throws: when the read fails the answer is English, `known` is false and `note` says why. */
export async function loadCommunityLocale(db: Pick<AppSupabase, "rpc">, center: { id: string; country?: string | null }): Promise<CommunityLocale> {
  const cc = countryCode(center.country);
  const fallback = (): CommunityLocale => ({ languages: ["en"], known: false, note: UNREAD, country: cc, locale: communityLocale(["en"], cc) });
  try {
    const res = await db.rpc("community_languages", { p_center: center.id });
    if (res.error) {
      console.error("[languages] could not read the community's languages:", res.error);
      return fallback();
    }
    // null means the caller is not linked to this community: nothing to show, and English is the honest default.
    if (!Array.isArray(res.data)) {
      if (res.data !== null && res.data !== undefined) console.error("[languages] community_languages answered with something unexpected:", res.data);
      return fallback();
    }
    return localeOf(res.data, cc);
  } catch (error) {
    console.error("[languages] could not read the community's languages:", error);
    return fallback();
  }
}
