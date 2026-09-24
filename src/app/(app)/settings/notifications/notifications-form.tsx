"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { Toggle } from "@/components/controls";
import { BlockGrid, Card, InfoBox, TableWrap, buttonClass } from "@/components/ui";
import { hourLabel, type NotificationSettings } from "@/lib/settings-rules";

import { countChanges, saveLabel } from "../_components/settings-form";
import { saveRulesSectionAction } from "../rules/actions";

export type TriggerRow = { key: string; label: string; when: string; channel: string };

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function NotificationsForm({
  triggers,
  initial,
  version,
  languages,
  canEdit,
}: {
  triggers: TriggerRow[];
  initial: NotificationSettings;
  version: number | null;
  languages: string;
  canEdit: boolean;
}) {
  const flat = (s: NotificationSettings) => ({
    quiet_start_hour: s.quietStartHour,
    quiet_end_hour: s.quietEndHour,
    event_day: s.eventDayDuringQuietHours,
    ...Object.fromEntries(Object.entries(s.triggers).map(([k, v]) => [`t_${k}`, v])),
  });
  const [s, setS] = useState(initial);
  const dirty = countChanges(flat(initial), flat(s));
  return (
    <ActionForm action={saveRulesSectionAction} submitLabel="Save" hideSubmit>
      <input type="hidden" name="section" value="notifications" />
      <input type="hidden" name="version" value={version === null ? "" : String(version)} />
      <BlockGrid>
        <Card
          span={8}
          title="Automatic notifications"
          description="What each automatic message should do. The automatic sender is not switched on yet, so no message goes out from this list today."
          padded={false}
        >
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Trigger</th>
                  <th>When</th>
                  <th>Channel</th>
                  <th className="w-[120px]">Active</th>
                </tr>
              </thead>
              <tbody>
                {triggers.map((t) => {
                  const on = s.triggers[t.key] ?? true;
                  return (
                    <tr key={t.key}>
                      <td className="font-bold">{t.label}</td>
                      <td>{t.when}</td>
                      <td>{t.channel}</td>
                      <td>
                        <Toggle
                          name={`trigger_${t.key}`}
                          label={`${t.label} active`}
                          checked={on}
                          onChange={(x) => setS({ ...s, triggers: { ...s.triggers, [t.key]: x } })}
                          onNote={<span className="cc-status-ok">On</span>}
                          offNote={<span className="cc-status-warn">Off</span>}
                          disabled={!canEdit}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>
        <Card span={4} title="Global rules">
          <div className="flex flex-col gap-3">
            <div>
              <p className="crm-label">Quiet hours default</p>
              <div className="flex items-center gap-2">
                <select
                  name="quiet_start_hour"
                  aria-label="Quiet hours start"
                  className="crm-input"
                  value={s.quietStartHour}
                  onChange={(e) => setS({ ...s, quietStartHour: Number(e.target.value) })}
                  disabled={!canEdit}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
                <span className="text-muted">–</span>
                <select
                  name="quiet_end_hour"
                  aria-label="Quiet hours end"
                  className="crm-input"
                  value={s.quietEndHour}
                  onChange={(e) => setS({ ...s, quietEndHour: Number(e.target.value) })}
                  disabled={!canEdit}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </div>
              <p className="crm-hint">Members can set their own quiet hours in the app.</p>
            </div>
            <div>
              <p className="crm-label">Event-day reminders during quiet hours</p>
              <Toggle
                name="event_day_during_quiet_hours"
                label="Event-day reminders during quiet hours"
                checked={s.eventDayDuringQuietHours}
                onChange={(x) => setS({ ...s, eventDayDuringQuietHours: x })}
                onNote="Allowed"
                offNote="Held until quiet hours end"
                disabled={!canEdit}
              />
            </div>
            <div>
              <p className="crm-label">Languages</p>
              <InfoBox>{languages}</InfoBox>
            </div>
            <div>
              <p className="crm-label">SMS</p>
              <InfoBox>Codes and time-critical reminders only · STOP honored</InfoBox>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            {canEdit ? (
              <button type="submit" disabled={dirty === 0} className={buttonClass(dirty === 0 ? "off" : "primary")}>
                {saveLabel("Save", dirty)}
              </button>
            ) : (
              <p className="text-[12px] text-muted">Only people with settings.manage can change notification rules.</p>
            )}
          </div>
        </Card>
      </BlockGrid>
    </ActionForm>
  );
}
