import { ChipLinks } from "@/components/ui";

const VIEWS = [
  { key: "directory", label: "Directory", href: "/giving/matching" },
  { key: "submissions", label: "Submissions", href: "/giving/matching/submissions" },
  { key: "employers", label: "Employers on file", href: "/giving/matching/employers" },
] as const;

/** Gift matching's three views: the shared directory, what members told the community, and the employers on file. */
export function MatchingNav({ active }: { active: (typeof VIEWS)[number]["key"] }) {
  return <ChipLinks label="Gift matching views" active={active} items={VIEWS.map((v) => ({ key: v.key, label: v.label, href: v.href }))} />;
}

export const MATCHING_TITLE = "Giving";
export const MATCHING_DESCRIPTION = "Gift matching · employers' matching programs, shared by every community that uses CatchTheMatch";
