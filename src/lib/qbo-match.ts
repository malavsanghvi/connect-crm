// QuickBooks donor matching (o-qbo-match): the pure parts of the Donor matching
// screen — reading a match's evidence, labels, and which suggestions a bulk
// approve takes. No server imports; tested directly (tests/qbo-match.test.ts).

export const MATCH_TABS = [
  { key: "suggested", label: "Suggested" },
  { key: "not_mapped", label: "Not mapped yet" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "review", label: "Needs review" },
] as const;
export type MatchTab = (typeof MATCH_TABS)[number]["key"];

export function isMatchTab(v: unknown): v is MatchTab {
  return typeof v === "string" && MATCH_TABS.some((t) => t.key === v);
}

export const METHOD_LABEL: Record<string, string> = {
  crm_id: "QuickBooks ID on file",
  email: "Email",
  phone: "Phone",
  name_address: "Name + address",
  household_name: "Household name",
  sub_customer: "Sub-customer",
  ai: "AI suggestion",
  manual: "Chosen by hand",
};

export function methodLabel(m: string | null | undefined): string {
  return (m && METHOD_LABEL[m]) || m || "—";
}

export type Signal = { kind: string; label: string; qb: string | null; cc: string | null; reason?: string | null };
export type Evidence = {
  signals: Signal[];
  qb: { display_name: string | null; company: string | null; emails: string[]; phones: string[]; address: Record<string, string>; family_like: boolean };
  cc: { household: string | null; household_number: string | null; city: string | null; zip: string | null; members: string[]; primary: string | null; person: string | null };
};

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const asStrs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

/** The evidence jsonb, read defensively (every field may be missing). */
export function readEvidence(raw: unknown): Evidence {
  const o = asObj(raw);
  const qb = asObj(o.qb);
  const cc = asObj(o.cc);
  const addr = asObj(qb.address);
  const address: Record<string, string> = {};
  for (const [k, v] of Object.entries(addr)) if (typeof v === "string" && v) address[k] = v;
  const signals: Signal[] = (Array.isArray(o.signals) ? o.signals : []).map((s) => {
    const x = asObj(s);
    return { kind: asStr(x.kind) ?? "other", label: asStr(x.label) ?? "Signal", qb: asStr(x.qb), cc: asStr(x.cc), reason: asStr(x.reason) };
  });
  // The strongest signals first, in a fixed order.
  const order = ["crm_id", "email", "phone", "sub_customer", "name_address", "household_name", "member_name", "ai", "manual"];
  signals.sort((a, b) => (order.indexOf(a.kind) + 100) % 100 - (order.indexOf(b.kind) + 100) % 100);
  return {
    signals,
    qb: {
      display_name: asStr(qb.display_name),
      company: asStr(qb.company),
      emails: asStrs(qb.emails),
      phones: asStrs(qb.phones),
      address,
      family_like: qb.family_like === true,
    },
    cc: {
      household: asStr(cc.household),
      household_number: asStr(cc.household_number),
      city: asStr(cc.city),
      zip: asStr(cc.zip),
      members: asStrs(cc.members),
      primary: asStr(cc.primary),
      person: asStr(cc.person),
    },
  };
}

/** "Katy TX 77494" from a QuickBooks address. */
export function addressLine(a: Record<string, string>): string {
  return [a.line1, a.line2, [a.city, a.state].filter(Boolean).join(" "), a.zip].filter(Boolean).join(", ");
}

/** 0.97 → "97%". */
export function confidencePct(c: number | string | null | undefined): string {
  const n = typeof c === "string" ? Number(c) : c;
  return typeof n === "number" && Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
}

export function confidenceTone(c: number | string | null | undefined): "ok" | "warn" | "bad" {
  const n = Number(c);
  if (n >= 0.9) return "ok";
  if (n >= 0.6) return "warn";
  return "bad";
}

/** The treasurer's bulk threshold, typed as a percent (50–100); default 95. */
export function parseThreshold(v: unknown): number | null {
  const s = String(v ?? "").trim().replace(/%$/, "");
  if (s === "") return 0.95;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 50 || n > 100) return null;
  return n / 100;
}

export type SuggestionRow = { id: string; qbo_customer_id: string; confidence: number | string };

/**
 * Bulk approve: the best suggestion of each customer, when it clears the
 * threshold AND is clearly ahead of the customer's next one (more than 0.1),
 * so an ambiguous pair is never approved in bulk.
 */
export function bulkPick(rows: readonly SuggestionRow[], threshold: number): string[] {
  const by = new Map<string, SuggestionRow[]>();
  for (const r of rows) by.set(r.qbo_customer_id, [...(by.get(r.qbo_customer_id) ?? []), r]);
  const out: string[] = [];
  for (const list of by.values()) {
    const sorted = [...list].sort((a, b) => Number(b.confidence) - Number(a.confidence));
    const top = sorted[0]!;
    const next = sorted[1];
    if (Number(top.confidence) >= threshold && (!next || Number(top.confidence) - Number(next.confidence) > 0.1)) out.push(top.id);
  }
  return out;
}

export const LEVEL_LABEL: Record<string, string> = {
  family: "Family level — one QuickBooks customer per family",
  person: "Person level — one QuickBooks customer per person",
  mixed: "Mixed — decided per customer from its name",
};

/** What a match means for where the history lands, in plain words. */
export function landingText(personName: string | null, primaryName: string | null): string {
  if (personName) return `Person-level: recorded as ${personName}'s giving`;
  if (primaryName) return `Family-level: recorded on the primary member, ${primaryName}`;
  return "Family-level: the household has no primary member yet — choose one before its history can come in";
}

export const TXN_LABEL: Record<string, string> = {
  SalesReceipt: "Sales receipt",
  Payment: "Payment",
  Invoice: "Invoice",
  CreditMemo: "Credit memo",
  RefundReceipt: "Refund receipt",
  JournalEntry: "Journal entry",
  Deposit: "Deposit",
};
