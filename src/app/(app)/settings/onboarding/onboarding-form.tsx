"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, InfoBox, TableWrap, buttonClass } from "@/components/ui";
import { FIELD_SETTINGS, ONBOARDING_FIELDS, type FieldSetting } from "@/lib/settings-rules";

import { countChanges, saveLabel } from "../_components/settings-form";
import { saveRulesSectionAction } from "../rules/actions";

const SETTING_CLASS: Record<FieldSetting, string> = {
  required: "cc-status-ok",
  optional: "font-bold text-navy",
  hidden: "cc-status-warn",
};
const LABEL: Record<FieldSetting, string> = { required: "Required", optional: "Optional", hidden: "Hidden" };

export function OnboardingForm({ initial, version, canEdit }: { initial: Record<string, FieldSetting>; version: number | null; canEdit: boolean }) {
  const [values, setValues] = useState(initial);
  const dirty = countChanges(initial, values);
  return (
    <ActionForm action={saveRulesSectionAction} submitLabel="Save onboarding" hideSubmit>
      <input type="hidden" name="section" value="onboarding" />
      <input type="hidden" name="version" value={version === null ? "" : String(version)} />
      <BlockGrid>
        <Card span={8} title="Onboarding and profile fields" padded={false}>
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Applies to</th>
                  <th>Setting</th>
                  <th className="w-[230px]">
                    <span className="sr-only">Change</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ONBOARDING_FIELDS.map((f) => {
                  const v = values[f.key];
                  return (
                    <tr key={f.key}>
                      <td className="font-bold">{f.label}</td>
                      <td>{f.appliesTo}</td>
                      <td className={SETTING_CLASS[v]}>{LABEL[v]}</td>
                      <td>
                        {f.alwaysAsked ? (
                          <span className="flex justify-end">
                            <button type="button" disabled className={buttonClass("off", "xs")}>
                              Always asked
                            </button>
                          </span>
                        ) : (
                          <span role="radiogroup" aria-label={f.label} className="flex justify-end gap-1.5">
                            <input type="hidden" name={`field_${f.key}`} value={v} />
                            {FIELD_SETTINGS.map((o) => (
                              <button
                                key={o.value}
                                type="button"
                                role="radio"
                                aria-checked={v === o.value}
                                disabled={!canEdit}
                                onClick={() => setValues({ ...values, [f.key]: o.value })}
                                className={buttonClass(v === o.value ? "primary" : "ghost", "xs")}
                              >
                                {o.label}
                              </button>
                            ))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>
        <Card span={4} title="Family matching">
          <div className="flex flex-col gap-3">
            <div>
              <p className="crm-label">Match new sign-ins to households by</p>
              <InfoBox>Email or mobile on file</InfoBox>
            </div>
            <div>
              <p className="crm-label">&quot;Not my family&quot; requests</p>
              <InfoBox>Go to the membership coordinator&apos;s queue</InfoBox>
            </div>
            <div>
              <p className="crm-label">New households</p>
              <InfoBox>Community members until they apply for membership</InfoBox>
            </div>
          </div>
          <p className="crm-hint mt-3">
            Saved to the center&apos;s rules. The member app&apos;s onboarding does not read these settings yet, so members still see its
            built-in questions until it is updated.
          </p>
          <div className="mt-4 flex justify-end">
            {canEdit ? (
              <button type="submit" disabled={dirty === 0} className={buttonClass(dirty === 0 ? "off" : "primary")}>
                {saveLabel("Save onboarding", dirty)}
              </button>
            ) : (
              <p className="text-[12px] text-muted">Only people with settings.manage can change onboarding fields.</p>
            )}
          </div>
        </Card>
      </BlockGrid>
    </ActionForm>
  );
}
