// Reading a decision on a gift matching submission from its form (src/components/matching/decision-forms.tsx), for both the
// community's Gift matching screen and Platform › Gift matching directory. Pure: no I/O; the database decides who may.

import { isUuid } from "@/lib/search-params";

import { forwardReasonText, programFromForm, type ProgramFacts } from "./directory";

export type DecisionArgs = {
  p_submission: string;
  p_decision: "approve" | "reject" | "duplicate";
  p_program?: ProgramFacts;
  p_reason?: string;
  p_into_program?: string;
  p_into_submission?: string;
};

export type ParsedDecision = { ok: true; args: DecisionArgs } | { ok: false; error: string };

export function decisionFromForm(fd: FormData): ParsedDecision {
  const submission = String(fd.get("submission_id") ?? "");
  if (!isUuid(submission)) return { ok: false, error: "the submission was not found. Reload the page and try again." };
  const decision = String(fd.get("decision") ?? "");
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 500);
  if (decision === "reject") {
    if (!reason) return { ok: false, error: "say why it is rejected. The community that sent it sees the reason." };
    return { ok: true, args: { p_submission: submission, p_decision: "reject", p_reason: reason } };
  }
  if (decision === "duplicate") {
    const target = String(fd.get("duplicate_of") ?? "");
    const [kind, id] = target.split(":");
    if (!isUuid(id) || (kind !== "entry" && kind !== "submission")) return { ok: false, error: "choose the directory entry or the submission it repeats." };
    return {
      ok: true,
      args: {
        p_submission: submission,
        p_decision: "duplicate",
        p_reason: reason || undefined,
        p_into_program: kind === "entry" ? id : undefined,
        p_into_submission: kind === "submission" ? id : undefined,
      },
    };
  }
  if (decision === "approve") {
    // The submission's source travels in a hidden field; the date checked is today (the database sets it).
    const facts = programFromForm(fd, "community");
    if (!facts.ok) return { ok: false, error: lowerFirst(facts.error) };
    const into = String(fd.get("into_program") ?? "");
    return {
      ok: true,
      args: {
        p_submission: submission,
        p_decision: "approve",
        p_program: facts.facts,
        p_reason: reason || undefined,
        p_into_program: isUuid(into) ? into : undefined,
      },
    };
  }
  return { ok: false, error: "choose approve, reject or duplicate." };
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/** What the person is told after the database decided (`because`: why an approval went to Weaver's team). */
export function decisionMessage(status: string, context: "weaver" | "community", because?: string | null): string {
  switch (status) {
    case "approved":
      return context === "weaver"
        ? "Approved. The entry is in the directory, checked by Weaver's team today."
        : "Approved. It is in the directory now, marked verified by your community today.";
    case "forwarded":
      return `Sent to Weaver's team: ${forwardReasonText(because)}. Your edits go with it.`;
    case "rejected":
      return "Rejected. The reason is kept with the submission.";
    case "merged":
      return "Marked as a duplicate.";
    default:
      return "Done.";
  }
}
