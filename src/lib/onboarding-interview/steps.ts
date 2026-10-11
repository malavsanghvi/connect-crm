export const INTERVIEW_BASE = "/setup/onboarding/interview";
export const INTERVIEW_STEPS = [
  { key: "website", href: `${INTERVIEW_BASE}/website`, label: "Your website" },
  { key: "found", href: `${INTERVIEW_BASE}/found`, label: "What we found" },
  { key: "documents", href: `${INTERVIEW_BASE}/documents`, label: "Your documents" },
  { key: "questions", href: `${INTERVIEW_BASE}/questions`, label: "Questions" },
  { key: "plan", href: `${INTERVIEW_BASE}/plan`, label: "Your plan" },
] as const;
export type InterviewStepKey = (typeof INTERVIEW_STEPS)[number]["key"];
