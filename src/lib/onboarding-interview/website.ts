// The interview's first screen, "Start with your website" (docs/ONBOARDING_INTERVIEW.md, Part A, S1–S3), as plain
// functions: which social fields to ask, what to pre-fill them with, which pages of the site to suggest reading, and the
// "what this changes" line under each answer. No I/O, so the screen and the tests share it.

import { SOCIAL_KEYS } from "@/lib/setup";
import { webAddress, type OwnView } from "@/lib/site-found";

/** S2's networks: Setup's social list (Setup › Profile & brand) plus LinkedIn. Anything else goes under "Other". */
export const INTERVIEW_SOCIAL: readonly { key: string; label: string }[] = [...SOCIAL_KEYS.map((s) => ({ key: s.key, label: s.label })), { key: "linkedin", label: "LinkedIn" }];

/** Where a pre-filled value came from, said next to it. */
export type Origin = "profile" | "website" | null;

export type SocialField = { key: string; label: string; value: string; origin: Origin };

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * S2's fields: what the profile already saved comes first; otherwise what the read of the website found; otherwise empty.
 * Links the site has on networks outside the list come back as "other" fields, so nothing found is dropped.
 */
export function socialFields(saved: Readonly<Record<string, unknown>> | null, found: readonly { network: string; url: string }[]): SocialField[] {
  const known = new Set(INTERVIEW_SOCIAL.map((s) => s.key));
  const fields: SocialField[] = INTERVIEW_SOCIAL.map((s) => {
    const kept = saved && typeof saved[s.key] === "string" ? webAddress(saved[s.key]) : null;
    if (kept) return { key: s.key, label: s.label, value: kept, origin: "profile" };
    const seen = found.find((f) => f.network === s.key);
    return seen ? { key: s.key, label: s.label, value: seen.url, origin: "website" } : { key: s.key, label: s.label, value: "", origin: null };
  });
  const others = found.filter((f) => !known.has(f.network)).slice(0, 4);
  others.forEach((f, i) => fields.push({ key: `other_${i + 1}`, label: cap(f.network) || "Other", value: f.url, origin: "website" }));
  return fields;
}

/** A page of the site worth reading again on its own (S3), suggested from what the read sorted. */
export type PageSuggestion = { label: string; address: string; why: string };

const SUGGEST_KINDS: readonly { kind: string; why: string }[] = [
  { kind: "calendar", why: "a calendar" },
  { kind: "events", why: "events" },
  { kind: "school", why: "classes or a school" },
  { kind: "membership", why: "how to join" },
  { kind: "leadership", why: "who leads" },
];

/** Full address of a path on the site that was read (the report keeps paths). */
function onSiteAddress(site: string, path: string): string {
  const host = site.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * S3's suggestions: the giving links the read found, then one page of each kind worth a closer look (calendar, events,
 * classes, membership, leaders). Only pages the read was at least fairly sure about; at most six.
 */
export function pageSuggestions(view: OwnView | null): PageSuggestion[] {
  if (!view) return [];
  const out: PageSuggestion[] = view.organization.donate.map((d) => ({ label: d.label, address: d.url, why: "a giving page" }));
  for (const { kind, why } of SUGGEST_KINDS) {
    const page = view.groups.find((g) => g.kind === kind)?.pages.find((p) => p.sure !== "unsure");
    if (page) out.push({ label: page.title, address: onSiteAddress(view.site, page.path), why });
  }
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.address) ? false : (seen.add(s.address), true))).slice(0, 6);
}

/** "What this changes", under the website answer. */
export function websiteChanges(answer: { address: string } | { none: true }): string {
  if ("none" in answer) return "So we will ask for your name, address and contact details instead, and skip reading a website.";
  return "So Weaver reads your site once, politely, and shows you each fact it finds to confirm. Nothing on the site changes.";
}

/** "What this changes", under the social links. */
export function socialChanges(filled: number): string {
  return filled === 0
    ? "Nothing yet. Add any you use, or skip: you can add them later in Setup › Profile & brand."
    : `So your profile can show ${filled === 1 ? "this link" : `these ${filled} links`}, and a new website can link to ${filled === 1 ? "it" : "them"}.`;
}

/** "What this changes", under the other pages. */
export function pagesChanges(count: number): string {
  return count === 0 ? "Nothing yet. Skip this if your main site says it all." : `So Weaver also reads ${count === 1 ? "this page" : `these ${count} pages`} when it learns about you.`;
}
