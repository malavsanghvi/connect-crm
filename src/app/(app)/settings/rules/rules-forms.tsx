"use client";

import { useMemo, useState } from "react";

import { ChipGroup, Toggle } from "@/components/controls";
import { InfoBox } from "@/components/ui";
import { validateRulesJson } from "@/lib/center-rules";
import type { RuleSettings } from "@/lib/settings-rules";

import { countChanges, FieldGrid, SettingField, SettingsForm } from "../_components/settings-form";
import { saveBrandingAction, saveRulesJsonAction, saveRulesSectionAction } from "./actions";

type Common = { version: number | null; readOnly: boolean };
const READ_ONLY = "Only people with settings.manage can change rules.";

/** Chip options for numbers, keeping a non-standard current value selectable. */
function numberChips(values: number[], current: number, label: (n: number) => string = String) {
  const all = values.includes(current) ? values : [...values, current].sort((a, b) => a - b);
  return all.map((n) => ({ value: String(n), label: label(n) }));
}

function centsToDollars(c: number): string {
  return (c / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
export function MembershipForm({
  settings,
  yearlyTier,
  lifeTier,
  ...c
}: Common & { settings: RuleSettings; yearlyTier: string; lifeTier: string }) {
  const initial = {
    life_references_required: String(settings.lifeReferencesRequired),
    life_prior_yearly_months: String(settings.lifePriorYearlyMonths),
    child_login_age: String(settings.childLoginAge),
  };
  const [v, setV] = useState(initial);
  const set = (k: keyof typeof initial) => (x: string) => setV({ ...v, [k]: x });
  return (
    <SettingsForm action={saveRulesSectionAction} section="membership" version={c.version} dirty={countChanges(initial, v)} readOnly={c.readOnly} readOnlyNote={READ_ONLY}>
      <FieldGrid>
        <SettingField label="Yearly: reference tier">
          <InfoBox>{yearlyTier}</InfoBox>
        </SettingField>
        <SettingField label="Life: reference tier">
          <InfoBox>{lifeTier}</InfoBox>
        </SettingField>
        <SettingField label="References required for Life">
          <ChipGroup
            name="life_references_required"
            label="References required for Life"
            value={v.life_references_required}
            onChange={set("life_references_required")}
            options={numberChips([1, 2], settings.lifeReferencesRequired)}
            disabled={c.readOnly}
          />
        </SettingField>
        <SettingField label="Prior yearly membership for Life">
          <ChipGroup
            name="life_prior_yearly_months"
            label="Prior yearly membership for Life"
            value={v.life_prior_yearly_months}
            onChange={set("life_prior_yearly_months")}
            options={numberChips([0, 12, 24], settings.lifePriorYearlyMonths, (n) => (n === 0 ? "None" : `${n} months`))}
            disabled={c.readOnly}
          />
        </SettingField>
        <SettingField label="Child’s own login from age">
          <ChipGroup
            name="child_login_age"
            label="Child’s own login from age"
            value={v.child_login_age}
            onChange={set("child_login_age")}
            options={numberChips([13, 16, 18], settings.childLoginAge)}
            disabled={c.readOnly}
          />
        </SettingField>
        <SettingField label="Reference request expires">
          <InfoBox>{settings.referenceExpiryDays} days</InfoBox>
        </SettingField>
      </FieldGrid>
      <p className="crm-hint mt-3">
        The reference count and prior-membership rule are recorded for reviewers; the app does not yet block an application on them.
      </p>
    </SettingsForm>
  );
}

// ---------------------------------------------------------------------------
export function GivingForm({ settings, ...c }: Common & { settings: RuleSettings }) {
  const initial = { fee: settings.askDonorToCoverFees, soft: settings.boliSoftCloseMinutes > 0 };
  const [v, setV] = useState(initial);
  return (
    <SettingsForm action={saveRulesSectionAction} section="giving" version={c.version} dirty={countChanges(initial, v)} readOnly={c.readOnly} readOnlyNote={READ_ONLY}>
      <FieldGrid>
        <SettingField label="Ask donors to cover processing fees">
          <Toggle
            name="ask_donor_to_cover"
            label="Ask donors to cover processing fees"
            checked={v.fee}
            onChange={(x) => setV({ ...v, fee: x })}
            onNote="Ask at checkout"
            offNote="Do not ask"
            disabled={c.readOnly}
          />
        </SettingField>
        <SettingField label="Payment allocation">
          <InfoBox>Earliest open pledge first · preview shown</InfoBox>
        </SettingField>
        <SettingField label="Boli ties">
          <InfoBox>First recorded wins · all entries kept</InfoBox>
        </SettingField>
        <SettingField label="Boli soft close">
          <Toggle
            name="boli_soft_close"
            label="Boli soft close"
            checked={v.soft}
            onChange={(x) => setV({ ...v, soft: x })}
            onNote={settings.boliSoftCloseMinutes > 0 && initial.soft ? `${settings.boliSoftCloseMinutes} minutes` : "5 minutes"}
            offNote="Off"
            disabled={c.readOnly}
          />
        </SettingField>
        <SettingField label="Privacy defaults" wide>
          <InfoBox>Directory, photos and physical mail asked as opt-in during onboarding</InfoBox>
        </SettingField>
      </FieldGrid>
    </SettingsForm>
  );
}

// ---------------------------------------------------------------------------
export function LunchForm({ settings, ...c }: Common & { settings: RuleSettings }) {
  const initial = {
    child: settings.lunch.familyWithChildUnder12AtStart,
    senior: settings.lunch.seniorAtStart,
    slot_minutes: String(settings.lunch.slotMinutes),
    reminder_minutes_before: String(settings.lunch.reminderMinutesBefore),
    confirmation_hours_before: String(settings.rsvp.confirmationHoursBefore),
  };
  const [v, setV] = useState(initial);
  return (
    <SettingsForm action={saveRulesSectionAction} section="lunch" version={c.version} dirty={countChanges(initial, v)} readOnly={c.readOnly} readOnlyNote={READ_ONLY}>
      <FieldGrid>
        <SettingField label="Families with a child under 12">
          <Toggle
            name="family_with_child_under_12_at_start"
            label="Families with a child under 12 eat at lunch start"
            checked={v.child}
            onChange={(x) => setV({ ...v, child: x })}
            onNote="Eat together at lunch start"
            offNote="Slotted like other adults"
            disabled={c.readOnly}
          />
        </SettingField>
        <SettingField label="Families with a senior">
          <Toggle
            name="senior_at_start"
            label="Families with a senior eat at lunch start"
            checked={v.senior}
            onChange={(x) => setV({ ...v, senior: x })}
            onNote="Eat together at lunch start"
            offNote="Slotted like other adults"
            disabled={c.readOnly}
          />
        </SettingField>
        <SettingField label="Slot length for new events">
          <ChipGroup
            name="slot_minutes"
            label="Slot length for new events"
            value={v.slot_minutes}
            onChange={(x) => setV({ ...v, slot_minutes: x })}
            options={numberChips([15, 20, 30], settings.lunch.slotMinutes, (n) => `${n} min`)}
            disabled={c.readOnly}
          />
        </SettingField>
        <SettingField label="Lunch slot reminder">
          <ChipGroup
            name="reminder_minutes_before"
            label="Lunch slot reminder"
            value={v.reminder_minutes_before}
            onChange={(x) => setV({ ...v, reminder_minutes_before: x })}
            options={numberChips([0, 5, 10], settings.lunch.reminderMinutesBefore, (n) => (n === 0 ? "Off" : `${n} min before`))}
            disabled={c.readOnly}
          />
        </SettingField>
        <SettingField label="RSVP confirmation" wide>
          <ChipGroup
            name="confirmation_hours_before"
            label="RSVP confirmation"
            value={v.confirmation_hours_before}
            onChange={(x) => setV({ ...v, confirmation_hours_before: x })}
            options={numberChips([24, 48, 72], settings.rsvp.confirmationHoursBefore, (n) => `${n} hours before`)}
            disabled={c.readOnly}
          />
        </SettingField>
      </FieldGrid>
    </SettingsForm>
  );
}

// ---------------------------------------------------------------------------
export function BolisStoreForm({ settings, currency, ...c }: Common & { settings: RuleSettings; currency: string }) {
  const initial = {
    boli_step: centsToDollars(settings.boliStepCents),
    gift_pack: centsToDollars(settings.store.giftPackCents),
    cancel_hours_before_pickup: String(settings.store.cancelHoursBeforePickup),
  };
  const [v, setV] = useState(initial);
  return (
    <SettingsForm action={saveRulesSectionAction} section="bolis_store" version={c.version} dirty={countChanges(initial, v)} readOnly={c.readOnly} readOnlyNote={READ_ONLY}>
      <FieldGrid>
        <SettingField label={`Boli step (${currency})`} hint="Each new pledge must beat the last by at least this much.">
          <input
            name="boli_step"
            inputMode="decimal"
            aria-label="Boli step"
            className="crm-input"
            value={v.boli_step}
            onChange={(e) => setV({ ...v, boli_step: e.target.value })}
            readOnly={c.readOnly}
          />
        </SettingField>
        <SettingField label={`Gift packing price (${currency})`}>
          <input
            name="gift_pack"
            inputMode="decimal"
            aria-label="Gift packing price"
            className="crm-input"
            value={v.gift_pack}
            onChange={(e) => setV({ ...v, gift_pack: e.target.value })}
            readOnly={c.readOnly}
          />
        </SettingField>
        <SettingField label="Store cancellation window" wide>
          <ChipGroup
            name="cancel_hours_before_pickup"
            label="Store cancellation window"
            value={v.cancel_hours_before_pickup}
            onChange={(x) => setV({ ...v, cancel_hours_before_pickup: x })}
            options={numberChips([12, 24, 48], settings.store.cancelHoursBeforePickup, (n) => (n === 0 ? "Any time before pickup" : `Up to ${n} hours before pickup`))}
            disabled={c.readOnly}
          />
        </SettingField>
      </FieldGrid>
    </SettingsForm>
  );
}

// ---------------------------------------------------------------------------
export function PointsForm({ settings, ...c }: Common & { settings: RuleSettings }) {
  const p = settings.points;
  const initial = {
    day_complete_bonus: String(p.dayCompleteBonus),
    streak_rest_days_per_month: String(p.streakRestDaysPerMonth),
    anumodana_points: String(p.anumodanaPoints),
    anumodana_daily_cap: String(p.anumodanaDailyCap),
    support_points: String(p.supportPoints),
    behind_after_days: String(p.behindAfterDays),
  };
  const [v, setV] = useState(initial);
  const field = (k: keyof typeof initial, label: string, suffix: string) => (
    <SettingField label={label}>
      <div className="flex items-center gap-2">
        <input
          name={k}
          inputMode="numeric"
          aria-label={label}
          className="crm-input w-24"
          value={v[k]}
          onChange={(e) => setV({ ...v, [k]: e.target.value })}
          readOnly={c.readOnly}
        />
        <span className="text-[13px] text-muted">{suffix}</span>
      </div>
    </SettingField>
  );
  return (
    <SettingsForm action={saveRulesSectionAction} section="points" version={c.version} dirty={countChanges(initial, v)} readOnly={c.readOnly} readOnlyNote={READ_ONLY}>
      <FieldGrid>
        {field("day_complete_bonus", "Day-complete bonus", "points")}
        {field("streak_rest_days_per_month", "Streak rest days", "per month (travel or illness)")}
        {field("anumodana_points", "Anumodana", "points each")}
        {field("anumodana_daily_cap", "Anumodana daily limit", "a day")}
        {field("support_points", "Saathi support", "points · once per person per day")}
        {field("behind_after_days", "“Behind” after", "days without practice")}
      </FieldGrid>
    </SettingsForm>
  );
}

// ---------------------------------------------------------------------------
type Obj = Record<string, unknown>;

const BRANDING_FIELDS = [
  { key: "primary", label: "Primary colour", color: true },
  { key: "accent", label: "Accent colour", color: true },
  { key: "background", label: "Background colour", color: true },
  { key: "display_font", label: "Display font", color: false },
  { key: "body_font", label: "Body font", color: false },
  { key: "logo_url", label: "Logo URL (https)", color: false },
] as const;

const KNOWN_FLAGS: Record<string, string> = {
  store: "Satvik Store",
  bolis: "Bolis",
  pathshala: "Pathshala",
  gyan_path: "Gyan Path",
  my_jain_way: "My Jain Way",
  saathi: "Saathi",
  niva: "Niva assistant",
  recurring_giving: "Recurring giving",
  surveys: "Surveys",
};

export function BrandingForm({ branding, flags, readOnly }: { branding: Obj; flags: Obj; readOnly: boolean }) {
  const initialFlags = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const k of new Set([...Object.keys(KNOWN_FLAGS), ...Object.keys(flags)])) out[k] = flags[k] === true;
    return out;
  }, [flags]);
  const [brand, setBrand] = useState<Obj>(branding);
  const [flagState, setFlagState] = useState<Record<string, boolean>>(initialFlags);
  const dirty = countChanges(branding, brand) + countChanges(initialFlags, flagState);
  return (
    <SettingsForm action={saveBrandingAction} version={null} dirty={dirty} readOnly={readOnly} readOnlyNote={READ_ONLY}>
      <input type="hidden" name="branding" value={JSON.stringify(brand)} />
      <input type="hidden" name="feature_flags" value={JSON.stringify(flagState)} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {BRANDING_FIELDS.map((f) => {
          const value = typeof brand[f.key] === "string" ? (brand[f.key] as string) : "";
          return (
            <div key={f.key}>
              <label htmlFor={`b-${f.key}`} className="crm-label">
                {f.label}
              </label>
              <div className="flex gap-2">
                {f.color ? (
                  <input
                    type="color"
                    aria-label={`${f.label} picker`}
                    value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
                    onChange={(e) => setBrand({ ...brand, [f.key]: e.target.value.toUpperCase() })}
                    disabled={readOnly}
                    className="h-[42px] w-14 cursor-pointer rounded-[10px] border border-line-strong bg-white"
                  />
                ) : null}
                <input
                  id={`b-${f.key}`}
                  value={value}
                  onChange={(e) => setBrand({ ...brand, [f.key]: e.target.value })}
                  readOnly={readOnly}
                  className="crm-input"
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="crm-label mt-4">Features switched on</p>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {Object.keys(flagState).map((k) => (
          <div key={k} className="flex min-h-[40px] items-center">
            <Toggle
              label={KNOWN_FLAGS[k] ?? k}
              checked={flagState[k]}
              onChange={(x) => setFlagState({ ...flagState, [k]: x })}
              onNote={KNOWN_FLAGS[k] ?? k}
              offNote={KNOWN_FLAGS[k] ?? k}
              disabled={readOnly}
            />
          </div>
        ))}
      </div>
      <p className="crm-hint">Other branding keys already stored are kept unchanged.</p>
    </SettingsForm>
  );
}

// ---------------------------------------------------------------------------
export function AdvancedRulesForm({ rules, version, readOnly }: { rules: Obj; version: number | null; readOnly: boolean }) {
  const initial = useMemo(() => JSON.stringify(rules, null, 2), [rules]);
  const [text, setText] = useState(initial);
  const validation = useMemo(() => validateRulesJson(text), [text]);
  return (
    <SettingsForm action={saveRulesJsonAction} version={version} dirty={text === initial ? 0 : 1} submitLabel="Save rules JSON" readOnly={readOnly} readOnlyNote={READ_ONLY}>
      <p className="mb-2 text-[13px] text-muted">
        Every rule key, including ones without a form above (identifier labels, bank format, voting, accounting). Unknown keys are allowed;
        known keys are type-checked. Saving here also bumps the version.
      </p>
      <label htmlFor="rules" className="sr-only">
        Rules JSON
      </label>
      <textarea
        id="rules"
        name="rules"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={22}
        readOnly={readOnly}
        className="crm-input mono"
        aria-invalid={!validation.ok}
        aria-describedby="rules-status"
      />
      <div id="rules-status" aria-live="polite" className="mt-2 text-[13px]">
        {validation.ok ? (
          <p className="text-success">Valid rules.</p>
        ) : (
          <ul className="list-disc pl-5 text-danger">
            {validation.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </SettingsForm>
  );
}
