import { Alert, Card, StatusText } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { summarizeHttps } from "@/lib/https";
import { platformPublicAddresses, readHttpsStatus } from "@/lib/https-server";

// "Portal address and HTTPS" (o-https): what the droplet's HTTPS check found, in
// plain English, with the owner's next step. Server component; the Platform setup
// wizard's "Portal address and HTTPS" step embeds it (o-platform-setup).
export async function HttpsStatusPanel({ timeZone }: { timeZone: string }) {
  const [status, addr] = await Promise.all([readHttpsStatus(), platformPublicAddresses()]);
  const portalDomain = addr.ok ? addr.value.portal_domain : null;
  const s = summarizeHttps(status, portalDomain);
  const alertTone = s.tone === "ok" ? "success" : s.tone === "warn" ? "warning" : "danger";
  return (
    <Card
      title="Portal address and HTTPS"
      description={
        status.ok
          ? `Checked every minute · last check ${formatDateTime(status.status.checked_at, timeZone)}${status.status.caddy_version ? ` · web server ${status.status.caddy_version}` : ""}`
          : "Checked every minute on the server"
      }
    >
      <div className="flex flex-col gap-3">
        <Alert tone={alertTone} title={s.headline}>
          {s.next}
        </Alert>
        {!addr.ok ? (
          <Alert tone="danger" title="Could not read the saved portal address">
            {addr.error}. The HTTPS status below may be missing the portal domain.
          </Alert>
        ) : null}
        {s.lines.length ? (
          <ul className="flex flex-col gap-2 text-[13px]">
            {s.lines.map((l) => (
              <li key={`${l.name}-${l.text}`} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <span className="min-w-[220px] font-semibold">
                  <StatusText tone={l.tone}>{l.tone === "ok" ? "HTTPS" : l.tone === "bad" ? "Not working" : "http:// only"}</StatusText> · {l.name}
                </span>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="crm-hint">
          HTTPS starts by itself, with no redeploy, a few minutes after a name&apos;s DNS points at this server. Until a name&apos;s certificate is confirmed it keeps
          working on http://; after that, http:// sends visitors to https:// and browsers are told to stay on HTTPS.
        </p>
      </div>
    </Card>
  );
}
