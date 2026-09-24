"use client";

import { useState, type ReactNode } from "react";

import { ActionForm } from "@/components/action-form";
import { ChipGroup, Toggle } from "@/components/controls";
import { BlockGrid, Card, InfoBox, buttonClass } from "@/components/ui";
import type { SecuritySettings } from "@/lib/settings-rules";

import { countChanges, saveLabel } from "../_components/settings-form";
import { saveRulesSectionAction } from "../rules/actions";

function chips(values: number[], current: number, label: (n: number) => string) {
  const all = values.includes(current) ? values : [...values, current].sort((a, b) => a - b);
  return all.map((n) => ({ value: String(n), label: label(n) }));
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="crm-label">{label}</p>
      {children}
    </div>
  );
}

export function SecurityForm({
  initial,
  version,
  childLoginAge,
  canEdit,
}: {
  initial: SecuritySettings;
  version: number | null;
  childLoginAge: number;
  canEdit: boolean;
}) {
  const [s, setS] = useState(initial);
  const dirty = countChanges(initial, s);
  return (
    <ActionForm action={saveRulesSectionAction} submitLabel="Save security" hideSubmit>
      <input type="hidden" name="section" value="security" />
      <input type="hidden" name="version" value={version === null ? "" : String(version)} />
      <BlockGrid>
        <Card span={6} title="Members">
          <div className="flex flex-col gap-3">
            <Field label="Sign-in">
              <InfoBox>One-time code by email · Face ID or passkey on trusted devices is not available yet</InfoBox>
            </Field>
            <Field label="Shared email or phone with a child">
              <InfoBox>Every financial transaction needs a fresh one-time code</InfoBox>
            </Field>
            <Field label="Child’s own login">
              <InfoBox>From age {childLoginAge}, as set in Rules</InfoBox>
            </Field>
            <Field label="Account recovery">
              <InfoBox>Second verified contact, or in person at the office with ID</InfoBox>
            </Field>
            <Field label="Printed sign-in codes">
              <Toggle
                name="printed_signin_codes"
                label="Printed sign-in codes"
                checked={s.printedSigninCodes}
                onChange={(x) => setS({ ...s, printedSigninCodes: x })}
                onNote="Staff can issue one-time codes in person"
                offNote="Not allowed"
                disabled={!canEdit}
              />
            </Field>
          </div>
        </Card>
        <Card span={6} title="Admins and volunteers">
          <div className="flex flex-col gap-3">
            <Field label="Admin session length">
              <div className="flex flex-wrap items-center gap-3">
                <ChipGroup
                  name="admin_session_hours"
                  label="Admin session length"
                  value={String(s.adminSessionHours)}
                  onChange={(x) => setS({ ...s, adminSessionHours: Number(x) })}
                  options={chips([4, 8, 12], initial.adminSessionHours, (n) => `${n} hours`)}
                  disabled={!canEdit}
                />
                <ChipGroup
                  name="admin_idle_minutes"
                  label="Idle timeout"
                  value={String(s.adminIdleMinutes)}
                  onChange={(x) => setS({ ...s, adminIdleMinutes: Number(x) })}
                  options={chips([15, 30, 60], initial.adminIdleMinutes, (n) => `${n} minutes idle`)}
                  disabled={!canEdit}
                />
              </div>
            </Field>
            <Field label="Two-step verification (2FA) for staff">
              <Toggle
                name="require_2fa_for_staff"
                label="Require two-step verification for staff"
                checked={s.require2faForStaff}
                onChange={(x) => setS({ ...s, require2faForStaff: x })}
                onNote="Required: staff set up an authenticator app and enter its code at sign-in"
                offNote="Not required yet: staff who have set up an app still use it"
                disabled={!canEdit}
              />
            </Field>
            <Field label="Step-up code before">
              <InfoBox>
                Role grants, refunds and write-offs, month lock, module switches, merges, exports, ownership transfer — a code from the authenticator app
                within the last 5 minutes, checked by the database
              </InfoBox>
            </Field>
            <Field label="Ops devices">
              <InfoBox>Event PIN sign-in · kiosk lock · remote wipe · offline cache encrypted</InfoBox>
            </Field>
            <Field label="Platform support access">
              <InfoBox>Center consent, time-limited, visible banner, audited</InfoBox>
            </Field>
          </div>
          <p className="crm-hint mt-3">
            2FA and step-up are enforced: with the rule on, a staff session without 2FA opens only Account › Security until it passes, and the database
            refuses sensitive changes without a fresh code from anyone who has an app. Switching the rule off needs a fresh code too. Session length,
            idle timeout and printed codes are the center&apos;s recorded policy only: the sign-in service still uses its own session length.
          </p>
          <div className="mt-4 flex justify-end">
            {canEdit ? (
              <button type="submit" disabled={dirty === 0} className={buttonClass(dirty === 0 ? "off" : "primary")}>
                {saveLabel("Save security", dirty)}
              </button>
            ) : (
              <p className="text-[12px] text-muted">Only people with settings.manage can change security settings.</p>
            )}
          </div>
        </Card>
      </BlockGrid>
    </ActionForm>
  );
}
