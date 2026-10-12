// What happens in one Inbox row when a person decides: nothing, asking "Yes, approve?", typing a reason to decline, sending, done.
// Pure, so the rules (a decline needs a reason, an approval of a family request needs a relationship, a failure goes back to the form
// with everything still typed in) are tested without a browser. The row component only calls the existing server action when this
// says the state is `sending`.

export type FlowPhase = "idle" | "approve" | "decline" | "sending" | "done";

export type InboxFlow = {
  phase: FlowPhase;
  /** The form that was open when sending started, so a failure goes back to it with everything still typed in. */
  from: "approve" | "decline" | null;
  /** The relationship chosen (family requests only). */
  role: string | null;
  reason: string;
  /** In words, next to what the person did. Cleared by the next attempt. */
  error: string | null;
  /** What the server said when it worked. */
  message: string | null;
};

export type FlowEvent =
  | { type: "approve" }
  | { type: "decline" }
  | { type: "cancel" }
  | { type: "role"; role: string }
  | { type: "reason"; text: string }
  /** `needsRole`: a family request is approved with a relationship. */
  | { type: "send"; needsRole: boolean }
  | { type: "ok"; message: string }
  | { type: "fail"; error: string };

export const NEEDS_ROLE = "Choose their relationship to the family first.";
export const NEEDS_REASON = "Give a reason: it is kept with the record.";

export function initialFlow(role: string | null = null): InboxFlow {
  return { phase: "idle", from: null, role, reason: "", error: null, message: null };
}

export function flowReducer(s: InboxFlow, e: FlowEvent): InboxFlow {
  // Nothing but the answer changes a row while it is being sent, and a finished row stays finished.
  if (s.phase === "sending") {
    if (e.type === "ok") return { ...s, phase: "done", message: e.message, error: null };
    if (e.type === "fail") return { ...s, phase: s.from ?? "idle", from: null, error: e.error };
    return s;
  }
  if (s.phase === "done") return s;
  switch (e.type) {
    case "approve":
      return { ...s, phase: "approve", error: null };
    case "decline":
      return { ...s, phase: "decline", error: null };
    case "cancel":
      return { ...s, phase: "idle", reason: "", error: null };
    case "role":
      return { ...s, role: e.role, error: s.error === NEEDS_ROLE ? null : s.error };
    case "reason":
      return { ...s, reason: e.text, error: s.error === NEEDS_REASON ? null : s.error };
    case "send": {
      if (s.phase === "approve") {
        if (e.needsRole && !s.role) return { ...s, error: NEEDS_ROLE };
        return { ...s, phase: "sending", from: "approve", error: null };
      }
      if (s.phase === "decline") {
        if (!s.reason.trim()) return { ...s, error: NEEDS_REASON };
        return { ...s, phase: "sending", from: "decline", error: null };
      }
      return s;
    }
    case "ok":
    case "fail":
      return s;
  }
}

/** The form fields the existing actions read, for what the person chose. */
export function decisionFields(id: string, s: InboxFlow, withRole: boolean): Record<string, string> {
  const decline = s.from === "decline" || s.phase === "decline";
  return {
    id,
    decision: decline ? "reject" : "approve",
    reason: decline ? s.reason.trim() : "",
    ...(withRole && !decline && s.role ? { role: s.role } : {}),
  };
}
