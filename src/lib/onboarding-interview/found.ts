// The interview's second screen, "What we found" (docs/ONBOARDING_INTERVIEW.md, S4): one card per fact the read of the
// organization's own website found, each answered Right / Fix / Not us. Built from the real report view
// (src/lib/site-found.ts buildFoundView); nothing here invents a fact. No I/O.

import { languageLabel, normalizeLanguageCode } from "@/lib/languages";
import type { LogoView, OwnView, Swatch } from "@/lib/site-found";

export type FactKey = "name" | "short_name" | "about" | "email" | "phone" | "address" | "languages" | "logo" | "colours";

export type Fact = {
  key: FactKey;
  /** The card's question, in plain words. */
  label: string;
  /** What the read found: the first is the suggestion, the rest are other candidates. Empty when nothing was found. */
  values: string[];
  /** Where it came from, as far as the report says. */
  source: string;
  /** Where it would be kept once confirmed. */
  keptIn: string;
  /** The logo (logo card only). */
  logo?: LogoView;
  /** The colours (colours card only). */
  swatches?: Swatch[];
};

export type Decision = { kind: "right" } | { kind: "fixed"; value: string } | { kind: "not_us" } | { kind: "skipped" };

const PROFILE = "Setup › Profile & brand";

/** The facts in the order the card list shows them. Facts the read did not find still get a card, so they can be added. */
export function foundFacts(view: OwnView): Fact[] {
  const o = view.organization;
  const site = view.site || "your website";
  const fromSite = `Read from ${site}`;
  const logo = view.logos.find((l) => l.shown);
  const languages = o.languages
    .map((l) => normalizeLanguageCode(l))
    .filter((c): c is string => c !== null)
    .map((c) => languageLabel(c));
  const swatches = view.swatches.filter((s) => s.role !== "text" && s.role !== "background").slice(0, 4);
  return [
    { key: "name", label: "Your name", values: o.name ? [o.name] : [], source: fromSite, keptIn: `Your display name (${PROFILE})` },
    { key: "short_name", label: "A short name", values: [], source: "The read does not look for a short name", keptIn: `Short name (${PROFILE}), used where space is tight` },
    { key: "about", label: "What you do, in a sentence", values: o.description ? [o.description] : [], source: `${fromSite} (how the site describes itself)`, keptIn: `About (${PROFILE})` },
    { key: "email", label: "Public e-mail", values: o.emails, source: fromSite, keptIn: `Public e-mail (${PROFILE})` },
    { key: "phone", label: "Public phone", values: o.phones, source: fromSite, keptIn: `Public phone (${PROFILE})` },
    { key: "address", label: "Address", values: o.addresses, source: fromSite, keptIn: `Address (${PROFILE}); the map pin is set there too` },
    { key: "languages", label: "Languages", values: languages.length > 0 ? [languages.join(", ")] : [], source: `${fromSite} (the languages its pages are written in)`, keptIn: `Languages (${PROFILE})` },
    {
      key: "logo",
      label: "Logo",
      values: logo ? [logo.alt || "The picture shown here"] : [],
      source: logo ? `${logo.source} on ${site}` : fromSite,
      keptIn: "Your brand kit: the file is copied into Weaver, never linked",
      ...(logo ? { logo } : {}),
    },
    {
      key: "colours",
      label: "Colours",
      values: swatches.map((s) => `${s.roleLabel} ${s.hex}`),
      source: `${fromSite} (its style files)`,
      keptIn: "Your brand kit colours",
      ...(swatches.length > 0 ? { swatches } : {}),
    },
  ];
}

/** "What this changes", under a fact once it is answered. */
export function factChange(fact: Fact, decision: Decision | undefined): string {
  if (!decision) return fact.values.length > 0 ? "Nothing is kept until you answer." : "Nothing was found. Add it, or skip it for now.";
  switch (decision.kind) {
    case "right":
      return `So we will keep this as ${fact.keptIn.charAt(0).toLowerCase()}${fact.keptIn.slice(1)}.`;
    case "fixed":
      return `So we will keep your words instead: ${decision.value}`;
    case "not_us":
      return "So we will leave it out, and never use it.";
    case "skipped":
      return "Skipped for now. It stays here to answer later.";
  }
}

/** How many facts are answered, for the line above the cards. */
export function answeredCount(decisions: Readonly<Partial<Record<FactKey, Decision>>>): number {
  return Object.values(decisions).filter((d) => d && d.kind !== "skipped").length;
}
