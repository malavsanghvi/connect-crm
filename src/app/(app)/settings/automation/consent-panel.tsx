import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Card, StatusText } from "@/components/ui";
import { ACTIVITY_NOTICE, ACTIVITY_NOTICE_VERSION, SHARE_LABEL, agreementText, withdrawnText, type ActivityConsent } from "@/lib/activity/consent";

import { giveActivityConsentAction, setActivitySharingAction, withdrawActivityConsentAction } from "./actions";

/**
 * "Help us learn how your community uses Weaver": the community's agreement to activity recording (owner decisions 2026-10-11).
 * Not agreed: the notice, a choice to also let Weaver staff see counts (off), and "I agree". Agreed: when and which notice,
 * whether Weaver staff see counts (a second, separate yes), and "Withdraw agreement". Agreeing and changing the sharing need a
 * fresh 2FA check; the form opens the security-code window by itself when the database asks. Weaver staff see the state but
 * cannot decide for the community (canDecide false).
 */
export function ConsentPanel({ consent, tz, canDecide, centerId }: { consent: ActivityConsent; tz: string; canDecide: boolean; centerId: string }) {
  const withdrawn = withdrawnText(consent, tz);
  return (
    <Card
      span={12}
      title="Help us learn how your community uses Weaver"
      description="Optional · only your administrator can switch this on, and you can withdraw at any time"
    >
      <p className="mb-3 text-[13px]" data-testid="activity-agreement">
        Now: <StatusText tone={consent.agreed ? "ok" : "warn"}>{agreementText(consent, tz)}</StatusText>
        {consent.agreed ? (
          <>
            {" "}
            · Recording is <strong>{consent.recording ? "on" : "switched off at the moment"}</strong> · Weaver staff see counts: <strong>{consent.share ? "yes" : "no"}</strong>
          </>
        ) : null}
      </p>
      {withdrawn ? <p className="mb-3 text-[13px] text-muted">{withdrawn}</p> : null}

      <h3 className="crm-label mb-1">What you agree to (notice v{ACTIVITY_NOTICE_VERSION})</h3>
      <ul className="mb-4 list-disc space-y-1 pl-5 text-[13px]" data-testid="activity-notice">
        {ACTIVITY_NOTICE.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {!canDecide ? (
        <p className="crm-hint" data-testid="activity-weaver-note">
          Only this community&apos;s own administrator can agree, withdraw or change what Weaver staff see.{" "}
          <Link href={`/platform/centers/${centerId}`} className="crm-link">
            Platform › Centers
          </Link>{" "}
          shows the state.
        </p>
      ) : consent.agreed ? (
        <div className="space-y-4">
          <ActionForm
            action={setActivitySharingAction}
            submitLabel={consent.share ? "Stop letting Weaver staff see counts" : "Let Weaver staff see counts"}
            variant={consent.share ? "secondary" : "primary"}
            size="sm"
            className="space-y-1"
          >
            <input type="hidden" name="share" value={consent.share ? "false" : "true"} />
            <p className="text-[13px]">
              {consent.share
                ? "Weaver staff can see counts of how communities use Weaver, including yours (no names, no content)."
                : "Weaver staff cannot see anything about how your community uses Weaver."}
            </p>
            <p className="crm-hint">Changing this asks for a fresh 2FA code.</p>
          </ActionForm>
          <ActionForm
            action={withdrawActivityConsentAction}
            submitLabel="Withdraw agreement"
            variant="bad"
            size="sm"
            confirmMessage="Withdraw your agreement? Weaver stops noting how your community uses it and the ideas below are hidden. What was already noted is deleted after 400 days."
          />
        </div>
      ) : (
        <ActionForm action={giveActivityConsentAction} submitLabel="I agree" size="sm" className="space-y-3">
          <input type="hidden" name="notice_version" value={ACTIVITY_NOTICE_VERSION} />
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" name="share" className="mt-1" />
            <span>{SHARE_LABEL}</span>
          </label>
          <p className="crm-hint">Agreeing asks for a fresh 2FA code. Nothing is noted until you agree.</p>
        </ActionForm>
      )}
    </Card>
  );
}
