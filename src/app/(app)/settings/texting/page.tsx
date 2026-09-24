import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, NoAccess, PageHeader, QueryError, StatusText, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { hour12, registrationStatus } from "@/lib/messaging/labels";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { readNotificationSettings, rulesVersion } from "@/lib/settings-rules";

import { RecentMessages, SandboxNote, SuppressionsCard, TestSendCard } from "../_components/messaging-ui";
import { SegmentCounter } from "../_components/segment-counter";
import { saveTextingAction, setPhoneSignInAction } from "../messaging-actions";

export const metadata: Metadata = { title: "Texting · Settings" };

type Detail = Record<string, unknown>;
const txt = (d: Detail | undefined, k: string) => (typeof d?.[k] === "string" ? (d[k] as string) : "");

/**
 * Settings › Texting (ONBOARDING_PLAN §4 Step 1.4): US registration (10DLC
 * brand + campaign, or toll-free verification) as a record with its status —
 * the carriers' decision is relayed by Community Connect, never assumed —
 * STOP/HELP handling, quiet hours, phone sign-in, segment counting, a test text.
 */
export default async function TextingSettingsPage() {
  const session = await getSession();
  const center = session.center;
  const header = <PageHeader title="Settings" description={`Texts from ${center.short_name || center.name} · codes and time-critical reminders`} />;
  if (!canAccess(session, "messaging")) {
    return (
      <>
        {header}
        <NoAccess area="Texting settings" access="messaging" />
      </>
    );
  }
  const canManage = canAccess(session, "messagingManage");
  const [regRes, profileRes, connRes] = await Promise.all([
    session.db.from("texting_registrations").select("id, kind, status, brand_id, campaign_id, submitted_at, approved_at, detail, updated_at").eq("center_id", center.id),
    session.db.from("org_profiles").select("legal_name, ein, website, public_email").eq("center_id", center.id).maybeSingle(),
    session.db.from("integration_connections").select("status, settings, last_error").eq("center_id", center.id).eq("provider", "twilio").maybeSingle(),
  ]);
  const regs = regRes.data ?? [];
  const approved = regs.find((r) => r.status === "approved");
  const current = approved ?? regs.find((r) => r.status !== "draft") ?? regs[0];
  const d = (current?.detail ?? undefined) as Detail | undefined;
  const editable = !current || current.status === "draft" || current.status === "rejected";
  const rules = center.rules as Record<string, unknown> | null;
  const security = (rules?.security ?? {}) as Record<string, unknown>;
  const phoneSignIn = security.phone_sign_in !== false;
  const quiet = readNotificationSettings(center.rules);
  const samples = Array.isArray(d?.samples) ? (d!.samples as string[]) : [];
  const st = registrationStatus(current?.status);

  return (
    <>
      {header}
      <SandboxNote session={session} />
      <BlockGrid>
        <Card span={7} title="US texting registration" description="Carriers require every organization to register before it texts (10DLC brand and campaign, or a verified toll-free number). It takes days to weeks, so start early.">
          {regRes.error ? <QueryError what="the texting registration" error={regRes.error} retryHref="/settings/texting" /> : null}
          <p className="mb-2 text-[13px]">
            <StatusText tone={st.tone}>{st.label}</StatusText>
            {current ? <span className="text-muted"> · {current.kind === "10dlc" ? "10DLC" : "Toll-free"}</span> : null}
            {current?.submitted_at ? <span className="text-muted"> · submitted {formatDateTime(current.submitted_at, center.time_zone)}</span> : null}
          </p>
          {approved ? (
            <p className="mb-2 text-[13px]">
              Texts come from <span className="font-mono">{txt(d, "from_number") || "—"}</span>
              {approved.brand_id ? ` · brand ${approved.brand_id}` : ""}
              {approved.campaign_id ? ` · campaign ${approved.campaign_id}` : ""}.
            </p>
          ) : null}
          {current?.status === "rejected" && txt(d, "reviewer_note") ? <p className="mb-2 text-[13px] text-danger">Reason: {txt(d, "reviewer_note")}</p> : null}
          {connRes.data?.last_error ? <p className="mb-2 text-[12px] text-muted">{connRes.data.last_error}</p> : null}
          {canManage && editable ? (
            <ActionForm action={saveTextingAction} submitLabel="Save draft" size="sm" className="space-y-2"
              extraButtons={<button type="submit" name="submit" value="1" className={buttonClass("primary", "sm")} data-confirm="Submit the registration to the carriers? It cannot be changed while they review it.">Submit for registration</button>}>
              <label className="block">
                <span className="crm-label">Kind</span>
                <select name="kind" className="crm-input" defaultValue={current?.kind ?? "10dlc"}>
                  <option value="10dlc">10DLC (a local number: brand + campaign)</option>
                  <option value="toll_free">Toll-free verification</option>
                </select>
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label>
                  <span className="crm-label">Legal name</span>
                  <input name="legal_name" className="crm-input" defaultValue={txt(d, "legal_name") || (profileRes.data?.legal_name ?? "")} />
                </label>
                <label>
                  <span className="crm-label">EIN</span>
                  <input name="ein" className="crm-input" defaultValue={txt(d, "ein") || (profileRes.data?.ein ?? "")} placeholder="12-3456789" />
                </label>
                <label>
                  <span className="crm-label">Website</span>
                  <input name="website" className="crm-input" defaultValue={txt(d, "website") || (profileRes.data?.website ?? "")} />
                </label>
                <label>
                  <span className="crm-label">Contact email</span>
                  <input name="contact_email" className="crm-input" defaultValue={txt(d, "contact_email") || (profileRes.data?.public_email ?? "")} />
                </label>
              </div>
              <label className="block">
                <span className="crm-label">What you text about (use case)</span>
                <input name="use_case" className="crm-input" defaultValue={txt(d, "use_case")} placeholder="Sign-in codes, event reminders and urgent community alerts" />
              </label>
              <SegmentCounter name="sample_1" label="Sample message 1" defaultValue={samples[0] ?? `${center.short_name || center.name}: your sign-in code is 123456.`} />
              <SegmentCounter name="sample_2" label="Sample message 2" defaultValue={samples[1] ?? ""} />
              <SegmentCounter name="sample_3" label="Sample message 3 (optional)" defaultValue={samples[2] ?? ""} />
              <label className="block">
                <span className="crm-label">How people agree to texts (opt-in)</span>
                <input name="opt_in" className="crm-input" defaultValue={txt(d, "opt_in")} placeholder="Members tick “Texts” in the app or on the membership form" />
              </label>
              <label className="block">
                <span className="crm-label">Texts a month (about)</span>
                <input name="volume" className="crm-input" defaultValue={txt(d, "volume")} placeholder="2,000" />
              </label>
              <label className="block">
                <span className="crm-label">Reason</span>
                <input name="reason" className="crm-input" placeholder="Register for texting" />
              </label>
            </ActionForm>
          ) : null}
        </Card>

        <Card span={5} title="Phone sign-in" description="Sign-in codes by text need texting to be registered. Switch it off to go live with email sign-in only.">
          <p className="mb-2 text-[13px]">
            {phoneSignIn ? <StatusText tone="ok">On</StatusText> : <StatusText tone="warn">Off · members sign in by email</StatusText>}
          </p>
          {canAccess(session, "centerSettings") ? (
            <ActionForm action={setPhoneSignInAction} submitLabel={phoneSignIn ? "Switch phone sign-in off" : "Switch phone sign-in on"} size="sm" variant="ghost">
              <input type="hidden" name="version" value={rulesVersion(center.rules) ?? ""} />
              <input type="hidden" name="phone_sign_in" value={phoneSignIn ? "off" : "on"} />
            </ActionForm>
          ) : null}
          <p className="crm-hint mt-3">
            STOP, START and HELP replies are handled automatically and recorded; a number that replied STOP gets nothing more until it replies START.
            Quiet hours ({hour12(quiet.quietStartHour)} – {hour12(quiet.quietEndHour)}, Settings › Notifications) hold back non-urgent texts; codes go at once.
          </p>
        </Card>

        <TestSendCard channel="sms" title="Send a test text" hint="Goes to your verified mobile unless you type a number · only once texting is approved" placeholder="+1 713 555 0100" canSend={canAccess(session, "messagingTest")} />
        <SuppressionsCard session={session} channels={["sms"]} canManage={canManage} />
        <RecentMessages session={session} channels={["sms"]} title="Recent texts" />
      </BlockGrid>
    </>
  );
}
