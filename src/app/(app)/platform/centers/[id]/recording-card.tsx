import { ActionForm } from "@/components/action-form";
import { Card, StatusText } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";

import { setActivityRecordingAction } from "./actions";

/** The state of the community's switch in one sentence: "On since 12 Oct 2026, 3:04 PM". */
export function recordingStateText(on: boolean, since: string | null, tz: string): string {
  if (since) return `${on ? "On" : "Off"} since ${formatDateTime(since, tz)}`;
  return on ? "On (the date it was switched on was not kept)" : "Never switched on";
}

/**
 * Platform › Centers › one center: switch activity recording on or off for the community (B91). Platform admins only (the page
 * checks, the database enforces). Off until Weaver switches it on, after the community has agreed; a reason is required and
 * kept in the audit log; the date of the change is shown.
 */
export function RecordingCard({ centerId, centerName, on, since, tz }: { centerId: string; centerName: string; on: boolean; since: string | null; tz: string }) {
  return (
    <Card
      span={12}
      title="Record how this community uses Weaver"
      description="Off unless the Weaver team switches it on, after the community has agreed · every change needs a reason and is audited"
    >
      <p className="mb-2 text-[13px]" data-testid="recording-state">
        Now: <StatusText tone={on ? "ok" : "warn"}>{on ? "On" : "Off"}</StatusText> · {recordingStateText(on, since, tz)}
      </p>
      <p className="crm-hint mb-3">
        When it is on, Weaver notes which screens and actions the community&apos;s staff and adult members use, how long each took and whether it worked, under a code that is
        different in every community. It never keeps names, amounts, notes, searches or anything typed. People under 18, Weaver administrators and anyone who opted out are
        never recorded. Staff with the settings permission then see counts and automation ideas in Settings › Automation ideas. What was noted is kept for 400 days.
      </p>
      <ActionForm
        action={setActivityRecordingAction}
        submitLabel={on ? "Switch recording off" : "Switch recording on"}
        variant={on ? "bad" : "primary"}
        size="sm"
        className="space-y-3"
        confirmMessage={
          on
            ? `Switch recording off for ${centerName}? Nothing new will be noted. What was already noted stays until it expires.`
            : `Switch recording on for ${centerName}? Only do this once the community has agreed. From then on its use of screens and actions is noted, without names or values.`
        }
      >
        <input type="hidden" name="center" value={centerId} />
        <input type="hidden" name="enable" value={on ? "false" : "true"} />
        <label className="block max-w-xl">
          <span className="crm-label">Reason</span>
          <input name="reason" className="crm-input" placeholder="Reason (required), for example who agreed and when" autoComplete="off" />
        </label>
      </ActionForm>
    </Card>
  );
}
