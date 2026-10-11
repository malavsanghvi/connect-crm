import { ActionForm } from "@/components/action-form";
import { Card, StatusText } from "@/components/ui";
import { agreementText, weaverCanSwitchOn, type ActivityConsent } from "@/lib/activity/consent";

import { setActivityRecordingAction } from "./actions";

/**
 * Platform › Centers › one center: the state of activity recording for the community, and Weaver's switch (B91). The community's
 * own administrator agrees (Settings › Automation ideas) and decides whether Weaver staff see counts; Weaver can switch
 * recording OFF at any time, and back ON only while that agreement stands. Platform admins only (the page checks, the database
 * enforces); a reason is required and kept in the audit log.
 */
export function RecordingCard({ centerId, centerName, consent, tz }: { centerId: string; centerName: string; consent: ActivityConsent; tz: string }) {
  const on = consent.recording;
  const canOn = weaverCanSwitchOn(consent);
  const blocked = !on && !canOn.ok;
  return (
    <Card
      span={12}
      title="Record how this community uses Weaver"
      description="Starts only when the community's own administrator agrees · Weaver can switch it off at any time · every change needs a reason and is audited"
    >
      <p className="mb-2 text-[13px]" data-testid="recording-state">
        Recording: <StatusText tone={on ? "ok" : "warn"}>{on ? "On" : "Off"}</StatusText> · Community&apos;s agreement:{" "}
        <StatusText tone={consent.agreed ? "ok" : "warn"}>{agreementText(consent, tz)}</StatusText>
        {consent.agreed ? (
          <>
            {" "}
            · Weaver staff may see counts: <strong>{consent.share ? "yes" : "no"}</strong>
          </>
        ) : null}
      </p>
      <p className="crm-hint mb-3">
        When recording is on, Weaver notes which screens and actions the community&apos;s staff and adult members use, how long each took and whether it worked, under a code that
        is different in every community. It never keeps names, amounts, notes, searches or anything typed. People under 18, Weaver administrators and anyone who opts out are never
        recorded. What is noted is kept for 400 days. Weaver staff see this community&apos;s counts and ideas only if its administrator agreed to share them.
      </p>
      <ActionForm
        action={setActivityRecordingAction}
        submitLabel={on ? "Switch recording off" : "Switch recording on"}
        variant={on ? "bad" : "primary"}
        submitDisabled={blocked}
        size="sm"
        className="space-y-3"
        confirmMessage={
          on
            ? `Switch recording off for ${centerName}? Nothing new will be noted. What was already noted stays until it expires.`
            : `Switch recording on for ${centerName}? Their administrator agreed, so noting how they use Weaver starts again, without names or values.`
        }
      >
        <input type="hidden" name="center" value={centerId} />
        <input type="hidden" name="enable" value={on ? "false" : "true"} />
        <label className="block max-w-xl">
          <span className="crm-label">Reason</span>
          <input name="reason" className="crm-input" placeholder="Reason (required)" autoComplete="off" disabled={blocked} />
        </label>
        {blocked && !canOn.ok ? (
          <p role="note" className="text-[13px] text-muted" data-testid="recording-blocked">
            {canOn.reason}
          </p>
        ) : null}
      </ActionForm>
    </Card>
  );
}
