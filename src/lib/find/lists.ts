// The Lists menu on the People home: the whole list of families, the whole list of people, and the screens that stay what they are
// (Directory & expertise, Voting eligibility, Memberships history). They are offered only to people who can open them today: the
// caller passes the tabs the person's role and the organization's modules already allow (visibleNav in src/lib/permissions.ts).

export type ListLink = { key: string; label: string; href: string; hint: string };

export const ALL_FAMILIES: ListLink = { key: "families", label: "All families", href: "/people?view=households", hint: "Every family, with its filters as chips" };
export const ALL_PEOPLE: ListLink = { key: "people", label: "All people", href: "/people?view=people", hint: "Every person, with age bands" };

const KEPT: { href: string; link: Omit<ListLink, "href"> }[] = [
  { href: "/people/directory", link: { key: "directory", label: "Directory & expertise", hint: "Who opted into the member directory and who offers what" } },
  { href: "/people/voting", link: { key: "voting", label: "Voting eligibility", hint: "Who may vote, and the two-person overrides" } },
  { href: "/memberships/applications", link: { key: "memberships", label: "Memberships history", hint: "Past and current membership applications" } },
];

/** The Lists menu for a person whose People tabs are `tabs`. The two whole lists need no extra permission beyond opening People. */
export function listsMenu(tabs: readonly { href: string }[]): ListLink[] {
  const open = new Set(tabs.map((t) => t.href));
  return [ALL_FAMILIES, ALL_PEOPLE, ...KEPT.filter((k) => open.has(k.href)).map((k) => ({ ...k.link, href: k.href }))];
}
