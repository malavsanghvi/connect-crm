"use client";

import { audienceChips } from "@/lib/events/report";

import { Note, sectionLabel, type CardProps } from "../parts";

const FLAGS: [string, string][] = [
  ["child_under_12", "Child under 12"],
  ["senior", "Senior"],
  ["assistance", "Assistance required"],
];

function audienceNote(value: string, school: string | null): string {
  switch (value) {
    case "public":
    case "members_and_guests":
      return "Anyone can RSVP, guests too.";
    case "members_only":
      return "Only members can RSVP.";
    case "life_members_only":
      return "Only life members can RSVP.";
    case "pathshala_families":
      return `Only ${school ?? "school"} families can RSVP.`;
    default:
      return "";
  }
}

/** Card 3, "Who": who can RSVP (the builder's choices; school families only where the kind has a school) and what each RSVP asks. */
export function WhoCard({ draft, set, ctx }: CardProps) {
  const chips = audienceChips(draft.audience, ctx.school);
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Who can RSVP" className="flex flex-col gap-2">
        {chips.map((c) => {
          const on = c.value === draft.audience || (c.label === "Everyone" && (draft.audience === "public" || draft.audience === "members_and_guests"));
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set({ audience: c.value })}
              className={`flex w-full flex-col items-start gap-0.5 rounded-[12px] border px-3.5 py-2.5 text-left ${on ? "border-navy bg-navy-50" : "border-line bg-white hover:border-navy-300"}`}
            >
              <span className="text-[15px] font-semibold text-ink">{c.label}</span>
              <span className="text-[13px] text-ink-2">{audienceNote(c.value, ctx.school)}</span>
            </button>
          );
        })}
      </div>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className={`${sectionLabel} mb-1`}>Ask about each attendee</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {FLAGS.map(([v, l]) => (
            <label key={v} className="flex min-h-[40px] items-center gap-2 text-[14px] text-ink">
              <input
                type="checkbox"
                checked={draft.attendee_flags.includes(v)}
                onChange={(e) => set({ attendee_flags: e.target.checked ? [...draft.attendee_flags, v] : draft.attendee_flags.filter((x) => x !== v) })}
                className="h-4 w-4 accent-navy"
              />
              {l}
            </label>
          ))}
        </div>
        <p className="crm-hint m-0">Adding guests and guest RSVPs by phone are always available (the RSVPs tab and the check-in desk).</p>
      </fieldset>
      <Note>These are questions on the RSVP form, not people. Children are counted, never named, anywhere Niva can see.</Note>
    </div>
  );
}
