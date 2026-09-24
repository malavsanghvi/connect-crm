// Pure helpers for confirmation and step-up modals.

/** Digits only, exactly 6 of them ("482 917" is accepted and becomes "482917"). */
export function normalizeStepUpCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]+/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * Turn a one-string confirmation ("Write off the open balance of this pledge?
 * This closes it.") into the prototype's modal shape: the question becomes
 * the title, anything after it becomes the body.
 */
export function splitConfirmMessage(message: string): { title: string; body: string | null } {
  const text = message.replace(/\s+/g, " ").trim();
  const q = text.indexOf("?");
  if (q > 0 && q < text.length - 1) {
    return { title: text.slice(0, q + 1), body: text.slice(q + 1).trim() || null };
  }
  if (q === text.length - 1) return { title: text, body: null };
  // Not phrased as a question: keep the whole sentence as the body.
  return { title: "Are you sure?", body: text || null };
}
