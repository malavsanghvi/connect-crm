// The interview's third screen, "Your documents" (docs/ONBOARDING_INTERVIEW.md, Part B, F1–F13): one card per kind of
// document, with why we ask and what we learn. Uploads use the existing private org-documents storage
// (uploadOrgDocumentAction in src/app/(app)/setup/actions.ts), which today knows only the kinds in DOCUMENT_KINDS
// (src/lib/setup.ts); the kinds it does not know yet are shown with "Coming next". No I/O.

import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/setup";

export type DocumentAsk = {
  id: string;
  title: string;
  /** When the interview asks for it ("Always", or the condition in plain words). */
  asked: string;
  why: string;
  learn: string;
  /** The kinds the upload can store it as today; empty when storage does not know this kind yet. */
  uploadKinds: readonly DocumentKind[];
};

/** Part B, row for row as the plan's table says it. */
export const DOCUMENT_ASKS: readonly DocumentAsk[] = [
  { id: "F1", title: "Charter or articles of incorporation", asked: "Always", why: "Who you legally are", learn: "Your legal name, the date you were formed and your purpose.", uploadKinds: [] },
  { id: "F2", title: "Constitution", asked: "Always", why: "Your founding rules and spirit", learn: "Your purpose and values, who may be a member, and your governing bodies.", uploadKinds: [] },
  { id: "F3", title: "Bylaws", asked: "Always", why: "How you run", learn: "Membership classes and rights, officer titles and terms, when elections are held, quorum and voting rules.", uploadKinds: [] },
  {
    id: "F4",
    title: "Policies (conduct, safeguarding, privacy, refunds, photos)",
    asked: "Always",
    why: "What must never be broken",
    learn: "The rules Niva and your website must keep, consent defaults, and the age from which a young person may sign in.",
    uploadKinds: [],
  },
  { id: "F5", title: "Annual report", asked: "Always", why: "Your size, programs and money at a glance", learn: "Your programs, how many members and donors you have, your funds and when your financial year starts.", uploadKinds: [] },
  { id: "F6", title: "Two or three recent newsletters", asked: "Always", why: "How you sound", learn: "Your tone, how you greet people, the languages you write in, and the events that come back each year.", uploadKinds: [] },
  { id: "F7", title: "Strategic plan", asked: "Always", why: "Where you are going", learn: "The priorities that order your plan, and what success in 90 days looks like.", uploadKinds: [] },
  {
    id: "F8",
    title: "Membership rules or application form",
    asked: "Only if membership is formal",
    why: "Who counts as a member",
    learn: "Membership types, references, approvals and family rules, as drafts for you to check.",
    uploadKinds: [],
  },
  {
    id: "F9",
    title: "Fee schedule (dues, tuition, tickets, rentals, sponsorships)",
    asked: "Only if you charge dues or fees, or run classes",
    why: "What people pay",
    learn: "Amounts and how often they are paid, as drafts only: nothing about money is saved without the owner's OK.",
    uploadKinds: [],
  },
  { id: "F10", title: "Org chart or committee list", asked: "Always", why: "Who decides what", learn: "Committees, roles and who reports to whom (adults only).", uploadKinds: [] },
  { id: "F11", title: "Event or festival calendar", asked: "Only if you run events", why: "Your year", learn: "The events that repeat and your seasons, as draft events.", uploadKinds: [] },
  {
    id: "F12",
    title: "Tax-exempt letter or charity registration",
    asked: "Only if you are registered",
    why: "Proof for going live",
    learn: "Your exempt status, kept with your legal identity for verification.",
    uploadKinds: ["determination_letter", "group_exemption"],
  },
  { id: "F13", title: "Anything else that explains you", asked: "Always", why: "What the list above missed", learn: "Whatever helps Weaver understand you.", uploadKinds: ["other"] },
];

/** The label Setup uses for a stored kind. */
export function uploadKindLabel(kind: DocumentKind): string {
  return DOCUMENT_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/** Can this card upload today? */
export const canUploadToday = (ask: DocumentAsk): boolean => ask.uploadKinds.length > 0;

/** The owner's decision on who reads the documents (docs/ONBOARDING_INTERVIEW.md §8, decision 1). */
export const WHO_CAN_SEE =
  "Only your owner and the people who manage your settings can open these documents. Weaver's platform team can open them only to verify you.";

/** "What this changes", under a card once it is answered. */
export function documentChange(ask: DocumentAsk, state: "uploaded" | "skipped" | null): string {
  if (state === "uploaded") return `So Weaver keeps your ${ask.title.toLowerCase()} in your private documents. Reading it is coming next.`;
  if (state === "skipped") return "Skipped for now. You can add it later.";
  return ask.asked === "Always" ? "Add it if you have it, or skip it for now." : `${ask.asked}. Skip it if it does not apply.`;
}
