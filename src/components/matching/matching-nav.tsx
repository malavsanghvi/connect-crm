import { ChipLinks } from "@/components/ui";

const VIEWS = [
  { key: "catch", label: "To catch", href: "/giving/matching/catch" },
  { key: "claims", label: "Claims", href: "/giving/matching/claims" },
  { key: "directory", label: "Directory", href: "/giving/matching" },
  { key: "library", label: "How to claim", href: "/giving/matching/library" },
  { key: "submissions", label: "Submissions", href: "/giving/matching/submissions" },
  { key: "employers", label: "Employers on file", href: "/giving/matching/employers" },
  { key: "ask", label: "Ask for employers", href: "/giving/matching/ask" },
] as const;

/** Gift matching's views: the members to catch, the claims, the shared directory, how to claim from each employer, what members told the community, and the employers on file. */
export function MatchingNav({ active }: { active: (typeof VIEWS)[number]["key"] }) {
  return <ChipLinks label="Gift matching views" active={active} items={VIEWS.map((v) => ({ key: v.key, label: v.label, href: v.href }))} />;
}

export const MATCHING_TITLE = "Giving";
export const MATCHING_DESCRIPTION = "Gift matching · employers' matching programs, shared by every community that uses CatchTheMatch";
