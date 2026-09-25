// Community Connect's own texts (legal_documents with center_id null, 0153/0422): the five
// agreements an organization's owner accepts, and the members' default privacy policy and terms
// of use shown where a community has not published its own. Pure.

export const PLATFORM_DOC_KINDS = ["org_terms", "dpa", "children_addendum", "sandbox_terms", "order_form", "privacy", "terms"] as const;
export type PlatformDocKind = (typeof PLATFORM_DOC_KINDS)[number];

export const PLATFORM_DOC_LABEL: Record<PlatformDocKind, string> = {
  org_terms: "Terms of service",
  dpa: "Data processing agreement",
  children_addendum: "Children's data addendum",
  sandbox_terms: "Sandbox terms",
  order_form: "Order form",
  privacy: "Members' privacy policy (default)",
  terms: "Members' terms of use (default)",
};

export const PLATFORM_DOC_NOTE: Record<PlatformDocKind, string> = {
  org_terms: "Accepted by each organization's owner.",
  dpa: "Accepted by each organization's owner.",
  children_addendum: "Accepted by each organization's owner.",
  sandbox_terms: "Accepted when a sandbox is created; owners of sandboxes accept new versions.",
  order_form: "Accepted by the owner of a live organization.",
  privacy: "Shown to members of a community that has not published its own privacy policy; members accept it in the app.",
  terms: "Shown to members of a community that has not published its own terms of use; members accept it in the app.",
};

export type PlatformDoc = { id: string; kind: string; version: string; title: string; body_md: string; published_at: string | null; created_at: string };

/** Per kind: the current published version, the draft (at most one), and the earlier versions, newest first. */
export function platformDocState(docs: PlatformDoc[], kind: string): { current: PlatformDoc | null; draft: PlatformDoc | null; history: PlatformDoc[] } {
  const ofKind = docs.filter((d) => d.kind === kind);
  const published = ofKind.filter((d) => d.published_at).sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  const draft = ofKind.filter((d) => !d.published_at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  return { current: published[0] ?? null, draft, history: published.slice(1) };
}

/** A suggested name for the next version: this month ("2026-10"), made unique against the existing ones. */
export function suggestVersion(existing: string[], today: string): string {
  const base = today.slice(0, 7);
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) if (!existing.includes(`${base}.${i}`)) return `${base}.${i}`;
}
