// Organizations of different kinds, for the tests that prove the portal's helpers (Niva's suggestions, the routines, the media library,
// the rail) speak for every organization and not only for the Jain Center. Built the way the database answers (app.category_profile).

import { LEGACY_KIND, parseKindProfile, type KindProfile } from "@/lib/kind";
import type { CommunityFormat } from "@/lib/community-format";

type Module = { availability: string; label: string | null };

export function kindOf(over: { key: string; label: string; faith: boolean; tradition: boolean; terms?: Record<string, string | null>; modules?: Record<string, Module> }): KindProfile {
  return parseKindProfile({
    category: { key: over.key, label: over.label, faith_based: over.faith, uses_tradition: over.tradition, terms: over.terms ?? {} },
    modules: over.modules ?? {},
  })!;
}

/** A Jain temple: the tradition pack, a school ("Pathshala") and a learning path ("Gyan Path"). */
export const JAIN: KindProfile = kindOf({ key: "jain_center", label: "Jain Center", faith: true, tradition: true, terms: LEGACY_KIND.terms });

/** A church: a faith community with a school of its own name, but no Jain tradition pack. */
export const CHURCH: KindProfile = kindOf({
  key: "church",
  label: "Church",
  faith: true,
  tradition: false,
  terms: { greeting: "Welcome", give_tab: "Offering", store: "Bookshop", school: "Sunday school", learning: "Bible study", place: "sanctuary", assistant_context: "a church" },
  modules: {
    bolis: { availability: "not_available", label: null },
    jain_way: { availability: "not_available", label: null },
    pathshala: { availability: "default_on", label: "Sunday school" },
    gyan_path: { availability: "default_off", label: "Bible study" },
  },
});

/** A mosque: another school word, another tradition-free community. */
export const MOSQUE: KindProfile = kindOf({
  key: "mosque",
  label: "Mosque",
  faith: true,
  tradition: false,
  terms: { greeting: "Salaam", store: "Store", school: "Weekend school", learning: "Quran circle", place: "prayer hall", assistant_context: "a mosque" },
  modules: {
    bolis: { availability: "not_available", label: null },
    jain_way: { availability: "not_available", label: null },
    pathshala: { availability: "default_on", label: "Weekend school" },
    gyan_path: { availability: "default_off", label: "Quran circle" },
  },
});

/** A chamber of commerce: no faith, no school, no learning path. */
export const CHAMBER: KindProfile = kindOf({
  key: "chamber_of_commerce",
  label: "Chamber of commerce",
  faith: false,
  tradition: false,
  terms: { greeting: "Welcome", give_tab: "Pay", store: "Store", school: null, learning: null, place: "office", assistant_context: "a chamber of commerce" },
  modules: {
    bolis: { availability: "not_available", label: null },
    pathshala: { availability: "not_available", label: null },
    gyan_path: { availability: "not_available", label: null },
    jain_way: { availability: "not_available", label: null },
    store: { availability: "default_off", label: "Store" },
  },
});

export const KINDS = { JAIN, CHURCH, MOSQUE, CHAMBER } as const;

/** Two or three currencies with the convention of the country that uses them. */
export const USD: CommunityFormat = { currency: "USD", locale: "en-US" };
export const INR: CommunityFormat = { currency: "INR", locale: "en-IN" };
export const GBP: CommunityFormat = { currency: "GBP", locale: "en-GB" };
