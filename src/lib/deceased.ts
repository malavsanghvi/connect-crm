// The deceased flag (owner decision 2026-09-25; migrations 0420–0423). Pure helpers for the
// portal's "Mark as deceased" form, its undo and the household's new-primary prompt. The
// database (app.mark_person_deceased / undo_person_deceased / set_household_primary) makes
// the same checks and is the enforcement; these only give the plain-English message first.

export type DeceasedForm = { deceasedOn: string; note: string | null; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validates the mark form. `today` is the community's local date (YYYY-MM-DD). */
export function parseDeceasedForm(
  raw: { deceased_on?: string | null; note?: string | null; reason?: string | null; confirm?: string | null },
  today: string,
  dateOfBirth?: string | null,
): { ok: true; value: DeceasedForm } | { ok: false; error: string } {
  const on = (raw.deceased_on ?? "").trim();
  const reason = (raw.reason ?? "").trim();
  const note = (raw.note ?? "").trim();
  if (!on) return { ok: false, error: "enter the date of death (an approximate date is fine; say so in the note)" };
  if (!validIsoDate(on)) return { ok: false, error: "the date of death is not a valid date" };
  if (on > today) return { ok: false, error: "the date of death cannot be in the future" };
  if (dateOfBirth && on < dateOfBirth) return { ok: false, error: "the date of death is before their date of birth" };
  if (!reason) return { ok: false, error: "give a reason (for example, who told the office) — it goes in the audit log" };
  if (reason.length > 1000 || note.length > 2000) return { ok: false, error: "the reason or note is too long" };
  if (raw.confirm !== "on") return { ok: false, error: "tick the box to confirm" };
  return { ok: true, value: { deceasedOn: on, note: note || null, reason } };
}

export type NewPrimaryPrompt = { householdId: string; name: string; livingMembers: number };

/** The households app.mark_person_deceased says need a new primary member. */
export function needsNewPrimary(result: unknown): NewPrimaryPrompt[] {
  const list = result && typeof result === "object" ? (result as { needs_new_primary?: unknown }).needs_new_primary : null;
  if (!Array.isArray(list)) return [];
  const out: NewPrimaryPrompt[] = [];
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    if (typeof r.household_id !== "string") continue;
    out.push({ householdId: r.household_id, name: typeof r.name === "string" ? r.name : "their household", livingMembers: Number(r.living_members ?? 0) || 0 });
  }
  return out;
}

/** The success message after marking someone deceased. */
export function markedMessage(name: string, result: unknown): string {
  const r = (result && typeof result === "object" ? result : {}) as { ended_memberships?: number; suppressed_messages?: number };
  const parts = [`${name} is recorded as deceased`];
  if (r.ended_memberships) parts.push(`${r.ended_memberships} membership${r.ended_memberships === 1 ? "" : "s"} ended`);
  if (r.suppressed_messages) parts.push(`${r.suppressed_messages} queued message${r.suppressed_messages === 1 ? "" : "s"} stopped`);
  const prompts = needsNewPrimary(result).filter((p) => p.livingMembers > 0);
  const tail = prompts.length ? ` Choose a new primary member for ${prompts.map((p) => p.name).join(" and ")}.` : "";
  return `${parts.join(" · ")} · audit logged.${tail}`;
}

/** Adults who can become the primary member: current, living, not merged, 18 or over (or age unknown). */
export function primaryCandidates<T extends { id: string; is_deceased: boolean; merged_into_id: string | null; date_of_birth: string | null }>(
  people: T[],
  today: string,
): T[] {
  const cutoff = `${Number(today.slice(0, 4)) - 18}${today.slice(4)}`;
  return people.filter((p) => !p.is_deceased && !p.merged_into_id && (!p.date_of_birth || p.date_of_birth <= cutoff));
}
