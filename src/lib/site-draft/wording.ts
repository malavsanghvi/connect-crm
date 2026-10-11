// The words the draft generator writes by itself: headings and the short neutral stand-ins for text that was missing.
// They follow the organization's kind through the portal's own wording helpers (src/lib/kind.ts, src/lib/wording.ts):
//   * a kind's named words (greeting, give, school, store) come from the kind's data, never from code;
//   * the tradition pack (festivals, daily opening times) is used only for a kind that keeps a tradition;
//   * so a chamber, a club or a neutral organization never meets a Jain word.
//
// Every stand-in is plain and general. None has a digit, a date or a name in it: a stand-in tells the person what to
// write, it does not say anything about the organization (the tests check this).

import { kindHas, kindTerm, type KindProfile } from "../kind";

export const STAND_IN = {
  welcome: "Add a short welcome here: who you are and who is welcome.",
  about: "Tell visitors about your organization: who you are, what you do and who is welcome. Replace this text with your own.",
  give: "Tell visitors how they can support you. Replace this text with your own.",
  contact: "Add the ways people can reach you, such as an email address, a phone number and where to find you.",
  learn: "Tell families about your classes and who they are for. Replace this text with your own.",
} as const;

export const NO_EVENTS = "No events are listed right now. Please check back soon.";

export type SiteWords = {
  /** The kind's own greeting, or null when it has none ("Welcome" is not repeated as an eyebrow). */
  greeting: string | null;
  homeTitle: string;
  aboutTitle: string;
  eventsTitle: string;
  eventsHeading: string;
  /** The title of the page about giving: the kind's own word ("Give", "Pay"). */
  giveTitle: string;
  giveHeading: string;
  giveOnline: string;
  contactTitle: string;
  contactHeading: string;
  mapHeading: string;
  galleryTitle: string;
  leadersHeading: string;
  aboutHeading: string;
  /** The word for the school or learning page when the old site did not give one. */
  learnTitle: string;
  classesHeading: string;
  storeHeading: string;
  seeEvents: string;
  /** Whether the kind keeps a tradition: only then are the daily opening times shown. */
  tradition: boolean;
};

export function siteWords(kind: Pick<KindProfile, "terms" | "modules" | "usesTradition">): SiteWords {
  const give = kindTerm(kind, "give_tab", "Give");
  const tradition = kindHas(kind, "tradition");
  const greeting = kindTerm(kind, "greeting", "");
  return {
    greeting: greeting === "" ? null : greeting,
    homeTitle: "Home",
    aboutTitle: "About us",
    eventsTitle: "Events",
    eventsHeading: tradition ? "Events and festivals" : "Upcoming events",
    giveTitle: give,
    giveHeading: give === "Give" ? "Ways to give" : `Ways to ${give.toLowerCase()}`,
    giveOnline: `${give} online`,
    contactTitle: "Contact us",
    contactHeading: "How to reach us",
    mapHeading: "Find us",
    galleryTitle: "Photos",
    leadersHeading: "Our leaders",
    aboutHeading: "About us",
    learnTitle: kindTerm(kind, "school", "Learning"),
    classesHeading: "Classes",
    storeHeading: kindTerm(kind, "store", "Store"),
    seeEvents: "See upcoming events",
    tradition,
  };
}

/** Every sentence and heading the generator can write for this kind on its own (the tests allow these and nothing else). */
export function ownWordsOf(kind: Pick<KindProfile, "terms" | "modules" | "usesTradition">): string[] {
  const w = siteWords(kind);
  const words = Object.values(w).filter((v): v is string => typeof v === "string");
  return [...words, ...Object.values(STAND_IN), NO_EVENTS];
}
