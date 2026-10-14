import { Field } from "@/components/ui";
import {
  DEADLINE_KINDS,
  DEADLINE_KIND_LABEL,
  GIFT_TYPES,
  GIFT_TYPE_LABEL,
  MONTHS,
  ORG_KINDS,
  ORG_KIND_LABEL,
  PORTALS,
  PORTAL_LABEL,
  RELIGIOUS_LABEL,
  RELIGIOUS_RULES,
  SOURCE_LABEL,
  WEAVER_SOURCES,
  amountInput,
  ratioInput,
  type ProgramRow,
} from "@/lib/matching/directory";

export type ProgramFieldsInitial = Partial<Omit<ProgramRow, "id">> & { names?: string[] };

/**
 * The facts of an employer's matching program, as one set of fields: Gift matching (a community sending what a member told
 * them, a manager editing before approving) and Platform › Gift matching directory (Weaver's team) use the same form, read by
 * programFromForm (src/lib/matching/directory.ts). Public facts only: the hint says so, because what is typed here is shared
 * with every community that has CatchTheMatch.
 */
export function ProgramFields({ idPrefix, initial, context, today }: { idPrefix: string; initial?: ProgramFieldsInitial; context: "weaver" | "community"; today?: string }) {
  const i = initial ?? {};
  const id = (k: string) => `${idPrefix}-${k}`;
  const giftOn = i.gift_match ?? true;
  return (
    <div className="flex flex-col gap-3" data-testid="program-fields">
      <p className="crm-hint m-0">
        Facts about the employer&apos;s program only. Never write who works there or who gave: what you send is shared with every community
        that uses gift matching.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company" htmlFor={id("company")}>
          <input id={id("company")} name="company_name" className="crm-input w-full" maxLength={160} required defaultValue={i.company_name ?? ""} dir="auto" />
        </Field>
        <Field label="Country (two letters)" htmlFor={id("country")} hint="For example US, IN or GB. Leave empty when the program is the same everywhere.">
          <input id={id("country")} name="country" className="crm-input w-24 uppercase" maxLength={2} defaultValue={i.country ?? ""} />
        </Field>
      </div>
      <Field label="Other names it goes by" htmlFor={id("names")} hint="One per line: an abbreviation, the name in another language or script, the parent company.">
        <textarea id={id("names")} name="names" className="crm-input w-full" rows={3} defaultValue={(i.names ?? []).join("\n")} dir="auto" />
      </Field>

      <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
        <legend className="crm-label">What the program does</legend>
        <label className="flex items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" name="gift_match" className="size-4" defaultChecked={giftOn} /> Matches gifts
        </label>
        <label className="flex items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" name="volunteer_grant" className="size-4" defaultChecked={i.volunteer_grant ?? false} /> Pays grants for volunteer hours
        </label>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Match ratio" htmlFor={id("ratio")} hint="What it gives for each 1 given: 1, 0.5 or 2.">
          <input id={id("ratio")} name="ratio" className="crm-input w-full" inputMode="decimal" defaultValue={ratioInput(i.match_ratio_bp)} />
        </Field>
        <Field label="Smallest gift matched" htmlFor={id("min")}>
          <input id={id("min")} name="min_gift" className="crm-input w-full" inputMode="decimal" defaultValue={amountInput(i.min_gift_cents)} />
        </Field>
        <Field label="Most matched per gift" htmlFor={id("max")}>
          <input id={id("max")} name="max_gift" className="crm-input w-full" inputMode="decimal" defaultValue={amountInput(i.max_gift_cents)} />
        </Field>
        <Field label="Most matched per year" htmlFor={id("year")}>
          <input id={id("year")} name="max_year" className="crm-input w-full" inputMode="decimal" defaultValue={amountInput(i.max_year_cents)} />
        </Field>
      </div>
      <Field label="Currency (three letters)" htmlFor={id("currency")} hint="The amounts above and below are in this currency.">
        <input id={id("currency")} name="currency" className="crm-input w-24 uppercase" maxLength={3} defaultValue={i.currency ?? "USD"} />
      </Field>
      <fieldset className="m-0 border-0 p-0">
        <legend className="crm-label">Gifts it matches</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {GIFT_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-[14px] text-ink">
              <input type="checkbox" name="gift_types" value={t} className="size-4" defaultChecked={(i.gift_types ?? []).includes(t)} /> {GIFT_TYPE_LABEL[t]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="crm-label">Kinds of organization that qualify</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ORG_KINDS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-[14px] text-ink">
              <input type="checkbox" name="org_kinds" value={k} className="size-4" defaultChecked={(i.org_kinds ?? []).includes(k)} /> {ORG_KIND_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Religious organizations" htmlFor={id("religious")} hint="Shown plainly on the entry, so members know before they ask.">
        <select id={id("religious")} name="religious_orgs" className="crm-input w-full" defaultValue={i.religious_orgs ?? ""}>
          <option value="">Not known yet</option>
          {RELIGIOUS_RULES.map((r) => (
            <option key={r} value={r}>
              {RELIGIOUS_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Note on which organizations qualify" htmlFor={id("elig")}>
        <textarea id={id("elig")} name="eligibility_note" className="crm-input w-full" rows={2} maxLength={500} defaultValue={i.eligibility_note ?? ""} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Where the employee asks" htmlFor={id("portal")}>
          <select id={id("portal")} name="portal" className="crm-input w-full" defaultValue={i.portal ?? ""}>
            <option value="">Not known yet</option>
            {PORTALS.map((p) => (
              <option key={p} value={p}>
                {PORTAL_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Link to the portal or form" htmlFor={id("portal-url")} hint="Starts with https://">
          <input id={id("portal-url")} name="portal_url" type="url" className="crm-input w-full" maxLength={500} defaultValue={i.portal_url ?? ""} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Deadline" htmlFor={id("deadline")} className="sm:col-span-2">
          <select id={id("deadline")} name="deadline_kind" className="crm-input w-full" defaultValue={i.deadline_kind ?? ""}>
            <option value="">Not known yet</option>
            {DEADLINE_KINDS.map((k) => (
              <option key={k} value={k}>
                {DEADLINE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Months (when within months)" htmlFor={id("months")}>
          <input id={id("months")} name="deadline_months" className="crm-input w-full" inputMode="numeric" defaultValue={i.deadline_months ?? ""} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Month" htmlFor={id("month")}>
            <select id={id("month")} name="deadline_month" className="crm-input w-full" defaultValue={i.deadline_month ? String(i.deadline_month) : ""}>
              <option value="">—</option>
              {MONTHS.map((m, n) => (
                <option key={m} value={String(n + 1)}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Day" htmlFor={id("day")}>
            <input id={id("day")} name="deadline_day" className="crm-input w-full" inputMode="numeric" defaultValue={i.deadline_day ?? ""} />
          </Field>
        </div>
      </div>
      <Field label="Note on the deadline" htmlFor={id("deadline-note")}>
        <input id={id("deadline-note")} name="deadline_note" className="crm-input w-full" maxLength={300} defaultValue={i.deadline_note ?? ""} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Volunteer grant per hour" htmlFor={id("vrate")}>
          <input id={id("vrate")} name="volunteer_per_hour" className="crm-input w-full" inputMode="decimal" defaultValue={amountInput(i.volunteer_cents_per_hour)} />
        </Field>
        <Field label="Fewest hours before it pays" htmlFor={id("vhours")}>
          <input id={id("vhours")} name="volunteer_min_hours" className="crm-input w-full" inputMode="numeric" defaultValue={i.volunteer_min_hours ?? ""} />
        </Field>
        <Field label="Most volunteer grant per year" htmlFor={id("vyear")}>
          <input id={id("vyear")} name="volunteer_max_year" className="crm-input w-full" inputMode="decimal" defaultValue={amountInput(i.volunteer_max_year_cents)} />
        </Field>
      </div>
      <Field label="Note on volunteer grants" htmlFor={id("vnote")}>
        <input id={id("vnote")} name="volunteer_note" className="crm-input w-full" maxLength={300} defaultValue={i.volunteer_note ?? ""} />
      </Field>
      <Field label="Other notes" htmlFor={id("notes")}>
        <textarea id={id("notes")} name="notes" className="crm-input w-full" rows={2} maxLength={1000} defaultValue={i.notes ?? ""} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        {context === "weaver" ? (
          <Field label="Where the facts come from" htmlFor={id("source")}>
            <select id={id("source")} name="source" className="crm-input w-full" required defaultValue={i.source && i.source !== "submission" ? i.source : "employer_site"}>
              {WEAVER_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Link to where the facts come from" htmlFor={id("source-url")} className={context === "weaver" ? "" : "sm:col-span-3"} hint="Starts with https://">
          <input id={id("source-url")} name="source_url" type="url" className="crm-input w-full" maxLength={500} defaultValue={i.source_url ?? ""} />
        </Field>
        {context === "weaver" ? (
          <Field label="Checked on" htmlFor={id("verified-on")} hint="The day you checked these facts on the source.">
            <input id={id("verified-on")} name="verified_on" type="date" className="crm-input w-full" max={today} defaultValue={today ?? ""} required />
          </Field>
        ) : null}
      </div>
    </div>
  );
}
