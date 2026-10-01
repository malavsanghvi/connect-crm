import type { Metadata } from "next";
import QRCode from "qrcode";

import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { BlockGrid, Card, NoAccess, PageHeader, QueryError, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { HOME_SHORTCUTS, homeShortcutRows, type HomeShortcutKey } from "@/lib/home-shortcuts";
import { isModuleEnabled, moduleLabelFor } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { rulesVersion } from "@/lib/settings-rules";
import { formatJoinCode, joinAppLink, joinWebLink } from "@/lib/tenancy";

import { rotateJoinCodeAction } from "./actions";
import { HomeShortcutsCard } from "./home-shortcuts-form";

export const metadata: Metadata = { title: "Member app · Settings" };

/**
 * Settings › Member app: the join code that opens this community in the
 * member app ("Find your community" → code, or a QR code on a poster). A
 * sandbox is reached only this way; a live community can also be found by name.
 * Also the Home shortcuts strip (centers.rules.home.shortcuts).
 */
export default async function MemberAppSettingsPage() {
  const session = await getSession();
  const center = session.center;
  const name = center.short_name || center.name;
  const sandbox = center.environment === "sandbox";
  const header = (
    <PageHeader
      title="Settings"
      description={`How members find ${name} in the Community Connect app, and the shortcuts on its Home`}
    />
  );
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Member app settings" access="centerSettings" />
      </>
    );
  }

  // A shortcut whose module is switched off is not shown to members, whatever is saved here.
  const moduleNotes: Partial<Record<HomeShortcutKey, string>> = {};
  for (const s of HOME_SHORTCUTS) {
    if (s.module && !isModuleEnabled(session, s.module)) moduleNotes[s.key] = `${moduleLabelFor(s.module)} is switched off (Settings › Modules), so members do not see this shortcut.`;
  }
  const homeShortcuts = (
    <HomeShortcutsCard initial={homeShortcutRows(center.rules)} version={rulesVersion(center.rules)} centerName={name} moduleNotes={moduleNotes} canEdit />
  );

  const res = await session.db
    .from("member_join_codes")
    .select("code, expires_at, created_at")
    .eq("center_id", center.id)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) {
    return (
      <>
        {header}
        <div className="mb-4">
          <QueryError what="the join code" error={res.error} retryHref="/settings/member-app" />
        </div>
        <BlockGrid>{homeShortcuts}</BlockGrid>
      </>
    );
  }
  const code = res.data?.code ?? null;
  const appLink = code ? joinAppLink(code) : null;
  const webLink = code ? joinWebLink(code, process.env.NEXT_PUBLIC_MEMBER_APP_URL) : null;
  let qr: string | null = null;
  if (appLink) {
    try {
      qr = await QRCode.toString(webLink ?? appLink, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    } catch (error) {
      console.error("[settings/member-app] could not draw the QR code:", error);
    }
  }

  const shareLink = webLink ?? appLink;
  const message = shareLink
    ? `Welcome to ${name}! Get the ${name} app and find your family in one minute: ${shareLink}${code ? ` (or enter the join code ${formatJoinCode(code)} in the app)` : ""}`
    : null;
  return (
    <>
      {header}
      <BlockGrid>
        {message ? (
          <Card span={12} title="Invite your members" description="Send this to your members by WhatsApp, text or email. Nothing is sent from here: you choose who gets it, so only people who asked to hear from you do.">
            <label className="crm-label" htmlFor="invite-message">
              Message
            </label>
            <textarea id="invite-message" readOnly rows={3} className="crm-input" value={message} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CopyButton value={message} label="Copy message" />
              <a className={buttonClass("ghost", "xs")} target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(message)}`}>
                WhatsApp
              </a>
              <a className={buttonClass("ghost", "xs")} href={`sms:?&body=${encodeURIComponent(message)}`}>
                Text message
              </a>
              <a className={buttonClass("ghost", "xs")} href={`mailto:?subject=${encodeURIComponent(`Join ${name} on the Community Connect app`)}&body=${encodeURIComponent(message)}`}>
                Email
              </a>
            </div>
            <p className="crm-hint mt-2">Members sign in, find their family (we match the records you loaded), then add their own details one question at a time.</p>
          </Card>
        ) : null}
        <Card
          span={7}
          title="Join code"
          description={
            sandbox
              ? "This is a sandbox: testers reach it in the member app only with this code. It never appears in search."
              : `Members can search for ${name} by name, or enter this code.`
          }
        >
          {code ? (
            <>
              <p className="font-mono text-[30px] font-bold tracking-[0.12em] text-navy" data-testid="join-code">
                {formatJoinCode(code)}
              </p>
              <p className="crm-hint">
                {res.data?.expires_at ? `Works until the end of ${formatDate(new Date(Date.parse(res.data.expires_at) - 1000).toISOString(), center.time_zone)}.` : "Does not expire."} In the app:
                Find your community › Enter a join code.
              </p>
              <dl className="mt-3 space-y-1 text-[13px]">
                <div>
                  <dt className="inline font-semibold">App link: </dt>
                  <dd className="inline font-mono">{appLink}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Web link: </dt>
                  <dd className="inline font-mono">
                    {webLink ?? <span className="font-sans text-muted">not available — the member web app&apos;s address (repository variable MEMBER_APP_URL) is not set</span>}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="text-[13px] text-muted">There is no active join code. Make one below.</p>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <ActionForm
              action={rotateJoinCodeAction}
              submitLabel={code ? "Make a new code" : "Make a code"}
              variant={code ? "warn" : "primary"}
              size="sm"
              resetOnSuccess
              confirmMessage={code ? "Make a new join code? The current code and every poster printed with it stop working at once." : undefined}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="min-w-[14rem] flex-1">
                <span className="crm-label">Reason</span>
                <input name="reason" className="crm-input" placeholder="Poster reprinted" required />
              </label>
              <label>
                <span className="crm-label">Expires (optional)</span>
                <input name="expires_on" type="date" className="crm-input" />
              </label>
            </ActionForm>
          </div>
        </Card>
        <Card span={5} title="QR code for posters" description="Scanning it opens the app on this community">
          {qr ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/svg+xml;utf8,${encodeURIComponent(qr)}`} alt={`QR code for join code ${code ? formatJoinCode(code) : ""}`} className="mx-auto h-56 w-56" />
              <p className="mt-2 text-center text-[13px]">
                <a className="underline" href={`data:image/svg+xml;utf8,${encodeURIComponent(qr)}`} download={`${center.slug}-join-qr.svg`}>
                  Download the QR code (SVG, prints sharp at any size)
                </a>
              </p>
            </>
          ) : code ? (
            <p role="alert" className="text-[13px] text-danger">
              Could not draw the QR code. The join code above still works; reload to try again.
            </p>
          ) : (
            <p className="text-[13px] text-muted">Make a join code first.</p>
          )}
        </Card>
        {homeShortcuts}
      </BlockGrid>
    </>
  );
}
