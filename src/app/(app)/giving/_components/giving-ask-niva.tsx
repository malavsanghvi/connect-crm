import { AskNiva } from "@/components/niva/ask-niva";

/** The sentence "Ask Niva" asks on each Giving screen: a question about what the screen is for, never a person. */
export const GIVING_ASK = {
  payments: "What is waiting for a second approver?",
  bank: "Which bank lines are still unmatched?",
  pledges: "Who is behind on pledges?",
} as const;

/** "Ask Niva" for the Giving header. It shows nothing when Niva is off or has no chat yet (AskNiva decides). */
export function GivingAskNiva({ about }: { about: keyof typeof GIVING_ASK }) {
  return <AskNiva prompt={GIVING_ASK[about]} />;
}
