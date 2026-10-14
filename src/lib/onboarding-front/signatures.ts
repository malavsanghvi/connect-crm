// What the front door's recogniser compares a file with: Guided onboarding's two templates (an exact match on headings
// goes straight to the checks) and every heading Guided onboarding can already place. Pure; built on the server and
// handed to the drop zone, so the browser does not load the import code itself.

import { PAYER_FIELDS, donationTemplateHeader } from "@/lib/onboarding/donations";
import { PERSON_FIELDS, personTemplateHeader } from "@/lib/onboarding/people";

import type { RecogniseContext } from "./recognise";

/**
 * `peopleWord` is the kind's name for its people ("members & families"); `withDonations` is false when the kind does not
 * offer giving (its template is then not offered either).
 */
export function recogniseContext(peopleWord: string, withDonations: boolean): RecogniseContext {
  const templates = [{ key: "people", label: peopleWord, headers: personTemplateHeader() }];
  if (withDonations) templates.push({ key: "donations", label: "past donations", headers: donationTemplateHeader() });
  const knownHeadings = [
    ...PERSON_FIELDS.flatMap((f) => [f.label, ...f.synonyms]),
    ...(withDonations ? PAYER_FIELDS.flatMap((f) => [f.label, ...f.synonyms]) : []),
  ];
  return { templates, knownHeadings: [...new Set(knownHeadings)] };
}
