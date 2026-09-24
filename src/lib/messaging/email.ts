// The email every message becomes: the center's header (logo, name, color),
// the text (escaped — template values can never inject HTML), the sandbox
// banner, and the footer (postal address, note, unsubscribe). Pure; shared by
// the worker (messaging.send) and the portal (the Auth send-email hook).

export type EmailBrand = {
  name: string;
  short_name?: string | null;
  primary_color?: string | null;
  logo_url?: string | null;
  public_email?: string | null;
};

export type EmailFooter = { postal_address?: string | null; note?: string | null };

export type EmailInput = {
  subject: string;
  body: string;
  brand: EmailBrand | null;
  footer?: EmailFooter | null;
  sandbox: boolean;
  unsubscribeUrl?: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

export const SANDBOX_BANNER = "Sandbox · test data";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const SAFE_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g;

/** Escaped text → HTML paragraphs, with bare https links made clickable. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const escaped = escapeHtml(para).replace(URL_RE, (u) => `<a href="${u}" style="color:inherit">${u}</a>`);
      return `<p style="margin:0 0 14px">${escaped.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

export function renderEmail(input: EmailInput): RenderedEmail {
  const name = input.brand?.name ?? "Community Connect";
  const color = input.brand?.primary_color && SAFE_COLOR.test(input.brand.primary_color) ? input.brand.primary_color : "#7a3e12";
  const subject = input.sandbox && !input.subject.startsWith(`[${SANDBOX_BANNER}]`) ? `[${SANDBOX_BANNER}] ${input.subject}` : input.subject;
  const footerLines = [input.footer?.postal_address, input.footer?.note].filter((l): l is string => !!l && l.trim() !== "");
  const banner = input.sandbox
    ? `<div style="background:#fff4d6;border:1px solid #e5c26a;color:#6b4e00;padding:8px 12px;font:600 13px system-ui,sans-serif;text-align:center">${SANDBOX_BANNER} · sent from a Community Connect sandbox, not a live community</div>`
    : "";
  const logo = input.brand?.logo_url
    ? `<img src="${escapeHtml(input.brand.logo_url)}" alt="${escapeHtml(name)}" style="max-height:48px;max-width:220px;display:block">`
    : `<div style="font:700 18px system-ui,sans-serif;color:${color}">${escapeHtml(name)}</div>`;
  const html = [
    `<!doctype html><html><body style="margin:0;background:#f6f3ee">`,
    banner,
    `<div style="max-width:600px;margin:0 auto;padding:24px 16px">`,
    `<div style="border-bottom:3px solid ${color};padding-bottom:12px;margin-bottom:20px">${logo}</div>`,
    `<div style="font:15px/1.55 system-ui,sans-serif;color:#1f1a14">${textToHtml(input.body)}</div>`,
    `<div style="margin-top:28px;padding-top:12px;border-top:1px solid #e2dccf;font:12px/1.5 system-ui,sans-serif;color:#6f6556">`,
    escapeHtml(name),
    ...footerLines.map((l) => `<br>${escapeHtml(l)}`),
    input.unsubscribeUrl ? `<br><a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6f6556">Unsubscribe from these emails</a>` : "",
    `</div></div></body></html>`,
  ].join("");
  const text = [
    input.sandbox ? `[${SANDBOX_BANNER}]\n` : "",
    input.body,
    "\n\n--\n",
    name,
    ...footerLines.map((l) => `\n${l}`),
    input.unsubscribeUrl ? `\nUnsubscribe: ${input.unsubscribeUrl}` : "",
  ].join("");
  return { subject, html, text };
}

/** The From header: the center's own verified sender, else Community Connect's address in the center's name. */
export function fromHeader(
  sender: { from_name: string; from_address: string } | null | undefined,
  brand: EmailBrand | null,
  platform: { address: string; name: string },
): string {
  const q = (n: string) => `"${n.replace(/["\\\r\n]/g, "")}"`;
  if (sender) return `${q(sender.from_name)} <${sender.from_address}>`;
  if (brand) return `${q(`${brand.name} via Community Connect`)} <${platform.address}>`;
  return `${q(platform.name)} <${platform.address}>`;
}

/** Public URL of an object in the public `branding` bucket. */
export function brandingUrl(supabaseUrl: string | null | undefined, path: string | null | undefined): string | null {
  if (!supabaseUrl || !path) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/branding/${path.split("/").map(encodeURIComponent).join("/")}`;
}
