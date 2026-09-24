"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { addPersonAction, findHouseholdsForPeopleAction, updateHouseholdAction } from "@/app/(app)/households/actions";
import { movePersonAction, updatePersonAction } from "@/app/(app)/people/actions";
import { ActionMessage } from "@/components/action-form";
import { ChipGroup, Toggle } from "@/components/controls";
import type { CardLabels, HouseholdCardData } from "@/components/household-card";
import { HouseholdPicker } from "@/components/household-picker";
import { useToast } from "@/components/toast";
import { InfoBox, SectionLabel, buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import {
  GENDER_OPTIONS,
  LANGUAGE_OPTIONS,
  RELATIONSHIP_OPTIONS,
  changedKeys,
  genderValue,
  saveLabel,
  tierLabel,
  toUsDate,
} from "@/lib/people";

import { UrlDrawer } from "./client";

/** Run a server action from a form; toast the outcome and keep errors on screen. */
function useFormAction<T>(
  action: (prev: ActionResult<T> | null, fd: FormData) => Promise<ActionResult<T>>,
  onSuccess?: (state: ActionResult<T>) => void,
) {
  const [state, run, pending] = useActionState(action, null);
  const toast = useToast();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (state.message) toast?.show(state.message, "ok");
      onSuccess?.(state);
    } else {
      toast?.show(state.error, "bad");
    }
    // onSuccess is a fresh closure every render; react to new states only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, toast]);
  return {
    state,
    pending,
    submit(e: FormEvent<HTMLFormElement>) {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      startTransition(() => run(fd));
    },
  };
}

function Field({ label, span = 1, children, htmlFor }: { label: string; span?: 1 | 2; children: ReactNode; htmlFor?: string }) {
  return (
    <div className={span === 2 ? "col-span-2" : "col-span-2 sm:col-span-1"}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="crm-label">
          {label}
        </label>
      ) : (
        <p className="crm-label">{label}</p>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Household edit (drawer)
// ---------------------------------------------------------------------------
export type HouseholdEditData = {
  id: string;
  number: string | null;
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postal: string;
  zoneId: string;
  directory: boolean;
  mail: boolean;
  tier: string;
  since: string | null;
  phone: string;
};

export function HouseholdEditDrawer({
  data,
  zones,
  canChangeTier,
  closeHref,
  backHref,
  notes,
}: {
  data: HouseholdEditData;
  zones: { id: string; name: string }[];
  canChangeTier: boolean;
  closeHref: string;
  backHref: string;
  notes: ReactNode;
}) {
  const router = useRouter();
  const initial = useMemo(
    () => ({
      display_name: data.name,
      address_line1: data.line1,
      address_line2: data.line2,
      city: data.city,
      state_region: data.state,
      postal_code: data.postal,
      zone_id: data.zoneId,
      directory_opt_in: data.directory,
      physical_mail_opt_in: data.mail,
      tier: data.tier,
    }),
    [data],
  );
  const [v, setV] = useState(initial);
  const [reason, setReason] = useState("");
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((cur) => ({ ...cur, [k]: val }));
  const dirty = changedKeys(initial, v).length;
  const tierChanged = v.tier !== initial.tier;
  const { state, pending, submit } = useFormAction(updateHouseholdAction, (s) => {
    if (s.ok) router.push(backHref, { scroll: false });
  });
  const formId = `hh-edit-${data.id}`;

  return (
    <UrlDrawer
      closeHref={closeHref}
      kicker={`Edit household · ${data.number ?? "no number yet"}`}
      title={data.name}
      subtitle="Changes are saved to the record and audited"
      footer={
        <>
          <button type="button" className={buttonClass("ghost")} onClick={() => router.push(backHref, { scroll: false })}>
            Back
          </button>
          <button type="submit" form={formId} disabled={pending || dirty === 0} className={buttonClass(dirty ? "primary" : "off")}>
            {pending ? "Saving…" : saveLabel(dirty)}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <SectionLabel>Household details</SectionLabel>
        <input type="hidden" name="id" value={data.id} />
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3">
          <Field label="Household name" span={2} htmlFor={`${formId}-name`}>
            <input id={`${formId}-name`} name="display_name" value={v.display_name} onChange={(e) => set("display_name", e.target.value)} className="crm-input" required />
          </Field>
          <Field label="Street address" span={2} htmlFor={`${formId}-l1`}>
            <input id={`${formId}-l1`} name="address_line1" value={v.address_line1} onChange={(e) => set("address_line1", e.target.value)} className="crm-input" autoComplete="street-address" />
          </Field>
          <Field label="Address line 2" span={2} htmlFor={`${formId}-l2`}>
            <input id={`${formId}-l2`} name="address_line2" value={v.address_line2} onChange={(e) => set("address_line2", e.target.value)} className="crm-input" />
          </Field>
          <Field label="City" htmlFor={`${formId}-city`}>
            <input id={`${formId}-city`} name="city" value={v.city} onChange={(e) => set("city", e.target.value)} className="crm-input" />
          </Field>
          <div className="col-span-2 grid grid-cols-2 gap-2.5 sm:col-span-1">
            <div>
              <label htmlFor={`${formId}-st`} className="crm-label">
                State
              </label>
              <input id={`${formId}-st`} name="state_region" value={v.state_region} onChange={(e) => set("state_region", e.target.value)} className="crm-input" />
            </div>
            <div>
              <label htmlFor={`${formId}-zip`} className="crm-label">
                ZIP
              </label>
              <input id={`${formId}-zip`} name="postal_code" value={v.postal_code} onChange={(e) => set("postal_code", e.target.value)} className="crm-input" inputMode="numeric" />
            </div>
          </div>
          <Field label="Main phone">
            <InfoBox>{data.phone || "—"}</InfoBox>
            <p className="crm-hint">From the primary member&apos;s profile</p>
          </Field>
          <Field label="Member since">
            <InfoBox>{data.since ? data.since.slice(0, 4) : "—"}</InfoBox>
          </Field>
          <Field label="Zone" span={2}>
            {zones.length ? (
              <ChipGroup
                label="Zone"
                name="zone_id"
                value={v.zone_id}
                onChange={(z) => set("zone_id", z)}
                options={zones.map((z) => ({ value: z.id, label: z.name }))}
              />
            ) : (
              <InfoBox>No zones are set up for this center</InfoBox>
            )}
          </Field>
          <Field label="Membership tier" span={2}>
            {canChangeTier ? (
              <>
                <ChipGroup
                  label="Membership tier"
                  name="tier"
                  value={v.tier}
                  onChange={(t) => set("tier", t)}
                  options={["community", "yearly", "life"].map((t) => ({ value: t, label: tierLabel(t) }))}
                />
                {tierChanged ? (
                  <div className="mt-2">
                    <label htmlFor={`${formId}-reason`} className="crm-label">
                      Why is the tier changing? (goes in the audit log)
                    </label>
                    <input
                      id={`${formId}-reason`}
                      name="tier_reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="crm-input"
                      placeholder="e.g. Life fee paid at the office, receipt 2026-0412"
                    />
                    <p className="crm-hint">The current membership ends today and the new tier starts today. No fee pledge is created.</p>
                  </div>
                ) : null}
              </>
            ) : (
              <InfoBox>{data.tier ? tierLabel(data.tier) : "No active membership"} · changes need membership approval</InfoBox>
            )}
          </Field>
          <Field label="Member directory">
            <Toggle label="Member directory" checked={v.directory_opt_in} onChange={(on) => set("directory_opt_in", on)} onNote="Listed" offNote="Not listed" />
            <input type="hidden" name="directory_opt_in" value={v.directory_opt_in ? "on" : "off"} />
          </Field>
          <Field label="Physical mail">
            <Toggle label="Physical mail" checked={v.physical_mail_opt_in} onChange={(on) => set("physical_mail_opt_in", on)} onNote="Opted in" offNote="Opted out" />
            <input type="hidden" name="physical_mail_opt_in" value={v.physical_mail_opt_in ? "on" : "off"} />
          </Field>
        </div>
        <ActionMessage state={state} showSuccess={false} />
      </form>
      {notes}
    </UrlDrawer>
  );
}

// ---------------------------------------------------------------------------
// Person drawer (profile form + sections + actions)
// ---------------------------------------------------------------------------
export type PersonEditData = {
  id: string;
  first: string;
  last: string;
  dob: string | null;
  gender: string | null;
  profession: string;
  employer: string;
  phone: string;
  email: string;
  language: string;
  photos: boolean;
  newMember: boolean;
  expertiseOptIn: boolean;
  expertise: string;
  isMinor: boolean;
  /** Role in the household the drawer is about (null when the person has no household). */
  household: { id: string; role: string; isPrimary: boolean } | null;
  /** Read-only values shown for adults (they live on the household). */
  directoryText: string;
  mailText: string;
  /** Minors: app-access line. */
  appAccessText: string;
};

export function PersonDrawer({
  data,
  editable,
  closeHref,
  kicker,
  title,
  subtitle,
  sections,
  actions,
}: {
  data: PersonEditData;
  editable: boolean;
  closeHref: string;
  kicker: string;
  title: string;
  subtitle: string;
  sections: ReactNode;
  actions: ReactNode;
}) {
  const router = useRouter();
  const initial = useMemo(
    () => ({
      first_name: data.first,
      last_name: data.last,
      date_of_birth: toUsDate(data.dob),
      gender: genderValue(data.gender),
      role: data.household?.role ?? "",
      profession: data.profession,
      employer: data.employer,
      phone_e164: data.phone,
      email: data.email,
      language: data.language,
      photo_opt_in: data.photos,
      new_member_contact_opt_in: data.newMember,
      expertise_opt_in: data.expertiseOptIn,
      expertise_headline: data.expertise,
    }),
    [data],
  );
  const [v, setV] = useState(initial);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((cur) => ({ ...cur, [k]: val }));
  const dirty = changedKeys(initial, v).length;
  const { state, pending, submit } = useFormAction(updatePersonAction, () => router.refresh());
  const formId = `person-edit-${data.id}`;
  const adult = !data.isMinor;

  const info = (value: ReactNode) => <InfoBox>{value || "—"}</InfoBox>;
  const text = (label: string, key: "first_name" | "last_name" | "date_of_birth" | "profession" | "employer" | "phone_e164" | "email" | "expertise_headline", span: 1 | 2 = 1, extra: Record<string, string> = {}) => (
    <Field label={label} span={span} htmlFor={editable ? `${formId}-${key}` : undefined}>
      {editable ? (
        <input id={`${formId}-${key}`} name={key} value={v[key]} onChange={(e) => set(key, e.target.value)} className="crm-input" {...extra} />
      ) : (
        info(v[key])
      )}
    </Field>
  );
  const toggle = (label: string, key: "photo_opt_in" | "new_member_contact_opt_in" | "expertise_opt_in", on: string, off: string) => (
    <Field label={label}>
      {editable ? (
        <>
          <Toggle label={label} checked={v[key]} onChange={(x) => set(key, x)} onNote={on} offNote={off} />
          <input type="hidden" name={key} value={v[key] ? "on" : "off"} />
        </>
      ) : (
        info(v[key] ? on : off)
      )}
    </Field>
  );
  const chips = (label: string, key: "gender" | "language" | "role", options: readonly { value: string; label: string }[], span: 1 | 2 = 1) => (
    <Field label={label} span={span}>
      {editable ? (
        <ChipGroup label={label} name={key} value={v[key]} onChange={(x) => set(key, x)} options={[...options]} />
      ) : (
        info(options.find((o) => o.value === v[key])?.label ?? v[key])
      )}
    </Field>
  );

  return (
    <UrlDrawer
      closeHref={closeHref}
      kicker={kicker}
      title={title}
      subtitle={subtitle}
      footer={
        <>
          {editable ? (
            <button type="submit" form={formId} disabled={pending || dirty === 0} className={buttonClass(dirty ? "primary" : "off")}>
              {pending ? "Saving…" : saveLabel(dirty)}
            </button>
          ) : null}
          {actions}
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <SectionLabel>{editable ? "Profile · edit and save" : "Profile · view only for your role"}</SectionLabel>
        <input type="hidden" name="id" value={data.id} />
        {data.household ? <input type="hidden" name="household_id" value={data.household.id} /> : null}
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3">
          {text("First name", "first_name")}
          {text("Last name", "last_name")}
          {text("Date of birth", "date_of_birth", 1, { placeholder: "MM/DD/YYYY", inputMode: "numeric" })}
          {chips("Gender", "gender", GENDER_OPTIONS)}
          {data.household ? (
            data.household.isPrimary ? (
              <Field label="Relationship" span={2}>
                {info("Primary member of this household")}
              </Field>
            ) : (
              chips("Relationship", "role", RELATIONSHIP_OPTIONS, 2)
            )
          ) : null}
          {adult ? (
            <>
              {text("Profession", "profession")}
              {text("Employer (matching gifts)", "employer")}
              {text("Mobile", "phone_e164", 1, { inputMode: "tel", autoComplete: "tel", placeholder: "(713) 555-0142" })}
              {text("Email", "email", 1, { inputMode: "email", autoComplete: "email" })}
              {chips("Language", "language", LANGUAGE_OPTIONS, 2)}
              <Field label="Member directory">{info(data.directoryText)}</Field>
              {toggle("Photos", "photo_opt_in", "Opted in", "Opted out")}
              <Field label="Physical mail">{info(data.mailText)}</Field>
              {toggle("Open to new members", "new_member_contact_opt_in", "Yes", "No")}
              {text("Expertise", "expertise_headline", 2, { placeholder: "e.g. Software engineer · happy to guide students on tech careers" })}
              {toggle("Expertise listing", "expertise_opt_in", "Listed in the directory", "Not listed")}
            </>
          ) : (
            <>
              <Field label="Contact" span={2}>
                {info("Through parents · no direct messages to minors")}
              </Field>
              <Field label="App access" span={2}>
                {info(data.appAccessText)}
              </Field>
            </>
          )}
        </div>
        <ActionMessage state={state} showSuccess={false} />
      </form>
      {sections}
    </UrlDrawer>
  );
}

// ---------------------------------------------------------------------------
// Add a person to a household
// ---------------------------------------------------------------------------
export function AddPersonDrawer({
  householdId,
  householdName,
  householdNumber,
  lastName,
  closeHref,
  backHref,
  personHref,
}: {
  householdId: string;
  householdName: string;
  householdNumber: string | null;
  lastName: string;
  closeHref: string;
  backHref: string;
  /** Where to go after saving: the new person's drawer ("{id}" is replaced). */
  personHref: string;
}) {
  const router = useRouter();
  const [role, setRole] = useState("child");
  const { state, pending, submit } = useFormAction(addPersonAction, (s) => {
    const id = s.ok ? s.data?.personId : undefined;
    router.push(id ? personHref.replace("{id}", id) : backHref, { scroll: false });
  });
  const formId = `add-person-${householdId}`;
  return (
    <UrlDrawer
      closeHref={closeHref}
      kicker={`Add a person · ${householdNumber ?? "household"}`}
      title={householdName}
      subtitle="Name, relationship and date of birth; adults can then sign in with their email or mobile"
      footer={
        <>
          <button type="button" className={buttonClass("ghost")} onClick={() => router.push(backHref, { scroll: false })}>
            Back
          </button>
          <button type="submit" form={formId} disabled={pending} className={buttonClass("primary")}>
            {pending ? "Adding…" : "Add person"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <SectionLabel>New member of this household</SectionLabel>
        <input type="hidden" name="household_id" value={householdId} />
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3">
          <Field label="First name" htmlFor={`${formId}-first`}>
            <input id={`${formId}-first`} name="first_name" className="crm-input" required autoFocus />
          </Field>
          <Field label="Last name" htmlFor={`${formId}-last`}>
            <input id={`${formId}-last`} name="last_name" className="crm-input" required defaultValue={lastName} />
          </Field>
          <Field label="Relationship" span={2}>
            <ChipGroup label="Relationship" name="role" value={role} onChange={setRole} options={RELATIONSHIP_OPTIONS} />
          </Field>
          <Field label="Date of birth" htmlFor={`${formId}-dob`}>
            <input id={`${formId}-dob`} name="date_of_birth" className="crm-input" placeholder="MM/DD/YYYY" inputMode="numeric" />
          </Field>
          <Field label="Gender">
            <ChipGroup label="Gender" name="gender" defaultValue="" options={[...GENDER_OPTIONS]} />
          </Field>
          <Field label="Mobile (adults)" htmlFor={`${formId}-phone`}>
            <input id={`${formId}-phone`} name="phone_e164" className="crm-input" inputMode="tel" placeholder="(713) 555-0142" />
          </Field>
          <Field label="Email (adults)" htmlFor={`${formId}-email`}>
            <input id={`${formId}-email`} name="email" className="crm-input" inputMode="email" />
          </Field>
        </div>
        <ActionMessage state={state} showSuccess={false} />
      </form>
    </UrlDrawer>
  );
}

// ---------------------------------------------------------------------------
// Move a person to another household
// ---------------------------------------------------------------------------
export function MovePersonDrawer({
  personId,
  firstName,
  name,
  from,
  labels,
  timeZone,
  currency,
  closeHref,
  backHref,
}: {
  personId: string;
  firstName: string;
  name: string;
  from: { id: string; name: string; number: string | null } | null;
  labels: CardLabels;
  timeZone: string;
  currency: string;
  closeHref: string;
  backHref: string;
}) {
  const router = useRouter();
  const [to, setTo] = useState<HouseholdCardData | null>(null);
  const [role, setRole] = useState("other");
  const { state, pending, submit } = useFormAction(movePersonAction, () => router.push(backHref, { scroll: false }));
  const formId = `move-${personId}`;
  return (
    <UrlDrawer
      closeHref={closeHref}
      kicker="Move household"
      title={name}
      subtitle={from ? `Leaving ${from.name}${from.number ? ` · ${from.number}` : ""}. Pledges and payments stay with that household.` : "Not in a household"}
      footer={
        <>
          <button type="button" className={buttonClass("ghost")} onClick={() => router.push(backHref, { scroll: false })}>
            Back
          </button>
          <button type="submit" form={formId} disabled={pending || !to || !from} className={buttonClass(to && from ? "primary" : "off")}>
            {pending ? "Moving…" : to ? `Move ${firstName}` : "Choose a household"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="id" value={personId} />
        <input type="hidden" name="first_name" value={firstName} />
        {from ? <input type="hidden" name="from" value={from.id} /> : null}
        <input type="hidden" name="to" value={to?.household_id ?? ""} />
        <SectionLabel>Destination household</SectionLabel>
        {to ? (
          <div className="cc-kv">
            <span>
              <strong>{to.household_name}</strong>
              <span className="block text-xs text-muted">
                {[to.household_number, to.org_household_id ? `${labels.orgHouseholdLabel} ${to.org_household_id}` : null, to.members].filter(Boolean).join(" · ")}
              </span>
            </span>
            <button type="button" className={buttonClass("ghost", "xs")} onClick={() => setTo(null)}>
              Change
            </button>
          </div>
        ) : (
          <HouseholdPicker
            labels={labels}
            timeZone={timeZone}
            currency={currency}
            onSelect={(c) => setTo(c)}
            selectLabel="Move here"
            idPrefix={`move-${personId}`}
            finder={findHouseholdsForPeopleAction}
          />
        )}
        <SectionLabel>Relationship in the new household</SectionLabel>
        <ChipGroup label="Relationship in the new household" name="role" value={role} onChange={setRole} options={RELATIONSHIP_OPTIONS} />
        <ActionMessage state={state} showSuccess={false} />
      </form>
    </UrlDrawer>
  );
}
