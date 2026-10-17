import { Field } from "@/components/ui";
import { linksToText, type Process } from "@/lib/matching/catch";

/** The library form's fields (Platform › Gift matching directory): the steps that got a match paid for one employer's program. Text only for now. */
export function ProcessFields({ idPrefix, initial, today }: { idPrefix: string; initial: Process | null; today: string }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="flex flex-col gap-3">
      <Field label="In one line, how the claim works" htmlFor={id("summary")} hint="For example: the member requests the match in Benevity and staff verify it.">
        <input id={id("summary")} name="summary" className="crm-input w-full" maxLength={400} required defaultValue={initial?.summary ?? ""} />
      </Field>
      <Field label="Who makes the request" htmlFor={id("who")}>
        <select id={id("who")} name="who_submits" className="crm-input w-full" required defaultValue={initial?.whoSubmits ?? "member"}>
          <option value="member">The member</option>
          <option value="organization">The organization</option>
          <option value="either">Either</option>
        </select>
      </Field>
      <Field label="The steps, one per line, in order" htmlFor={id("steps")} hint="Up to 20 steps, 400 characters each.">
        <textarea id={id("steps")} name="steps" className="crm-input w-full" rows={6} required defaultValue={(initial?.steps ?? []).join("\n")} />
      </Field>
      <Field label="What to have ready, one per line (optional)" htmlFor={id("documents")}>
        <textarea id={id("documents")} name="documents" className="crm-input w-full" rows={2} defaultValue={(initial?.documents ?? []).join("\n")} />
      </Field>
      <Field label="Links, one per line as: label | https://address (optional)" htmlFor={id("links")}>
        <textarea id={id("links")} name="links" className="crm-input w-full font-mono text-[13px]" rows={2} defaultValue={linksToText(initial?.links ?? [])} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="About how many days it takes (optional)" htmlFor={id("days")}>
          <input id={id("days")} name="typical_days" type="number" min={1} max={365} className="crm-input w-full" defaultValue={initial?.typicalDays ?? ""} />
        </Field>
        <Field label="The day you saw it work (optional)" htmlFor={id("worked-on")}>
          <input id={id("worked-on")} name="worked_on" type="date" max={today} className="crm-input w-full" defaultValue={initial?.workedOn ?? ""} />
        </Field>
      </div>
      <Field label="How it worked, in a few words (optional; no names)" htmlFor={id("worked-note")}>
        <input id={id("worked-note")} name="worked_note" className="crm-input w-full" maxLength={300} defaultValue={initial?.workedNote ?? ""} />
      </Field>
      <Field label="Tips (optional)" htmlFor={id("tips")}>
        <textarea id={id("tips")} name="tips" className="crm-input w-full" rows={3} maxLength={1000} defaultValue={initial?.tips ?? ""} />
      </Field>
    </div>
  );
}
