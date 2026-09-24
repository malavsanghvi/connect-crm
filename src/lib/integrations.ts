// Settings › Integrations: the prototype's eight services, each resolved from
// app.integration_connections. A service with no connection row (or no
// provider in the schema yet) reads "Not connected" with an honest detail —
// never a made-up "Connected".

import { isPlainObject } from "@/lib/center-rules";
import type { Json } from "@/lib/database.types";

export type ConnectionRow = {
  provider: string;
  status: string;
  display_name: string | null;
  settings: Json;
  connected_at: string | null;
  token_expires_at: string | null;
  last_error: string | null;
};

export type IntegrationService = {
  key: string;
  label: string;
  /** Providers (integration_connections.provider) that can back this service; the first connected one wins. */
  providers: string[];
  owner: string;
  /** Detail shown when nothing is connected. */
  notConnected: string;
  /** Where it is managed, when the app has a screen for it. */
  href?: string;
};

export const INTEGRATION_SERVICES: IntegrationService[] = [
  { key: "qbo", label: "QuickBooks Online", providers: ["quickbooks_online"], owner: "Treasurer", notConnected: "Connect and map accounts on the Accounting › QuickBooks page", href: "/accounting/qbo" },
  { key: "payments", label: "Payments", providers: ["stripe", "paypal"], owner: "Treasurer", notConnected: "No Stripe or PayPal account connected · offline payments are recorded by hand", href: "/settings/payments" },
  { key: "email", label: "Email sending domain", providers: ["sendgrid", "resend"], owner: "Communications", notConnected: "No sending service connected yet" },
  { key: "sms", label: "US business texting (10DLC)", providers: ["twilio"], owner: "Tech officer", notConnected: "No texting provider connected yet" },
  { key: "whatsapp", label: "WhatsApp Business", providers: ["whatsapp"], owner: "Communications", notConnected: "No WhatsApp Business number connected yet" },
  { key: "push", label: "Push notifications", providers: [], owner: "Platform", notConnected: "Managed by the platform · not tracked here yet" },
  { key: "panchang", label: "Panchang source", providers: [], owner: "Religious coordinator", notConnected: "No panchang source chosen yet" },
  { key: "background", label: "Background checks", providers: [], owner: "EC", notConnected: "Choose a screening provider" },
];

export type IntegrationStatus = { label: string; tone: "ok" | "warn" | "bad" };

export function connectionStatus(status: string | null | undefined): IntegrationStatus {
  switch (status) {
    case "connected":
      return { label: "Connected", tone: "ok" };
    case "expiring":
      return { label: "Connected · renew soon", tone: "warn" };
    case "error":
      return { label: "Error", tone: "bad" };
    default:
      return { label: "Not connected", tone: "warn" };
  }
}

export type IntegrationRow = IntegrationService & { status: IntegrationStatus; detail: string };

function settingText(settings: Json, key: string): string | null {
  const v = isPlainObject(settings) ? settings[key] : undefined;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function integrationRows(connections: ConnectionRow[]): IntegrationRow[] {
  return INTEGRATION_SERVICES.map((svc) => {
    const rows = connections.filter((c) => svc.providers.includes(c.provider));
    const row = rows.find((c) => c.status === "connected" || c.status === "expiring") ?? rows[0];
    if (!row || row.status === "disconnected") return { ...svc, status: connectionStatus(null), detail: svc.notConnected };
    const status = connectionStatus(row.status);
    if (row.status === "error") return { ...svc, status, detail: row.last_error ? `Last error: ${row.last_error}` : "The connection reported an error" };
    const basis = settingText(row.settings, "basis");
    const parts = [row.display_name, basis ? `${basis} basis` : null].filter(Boolean);
    return { ...svc, status, detail: parts.length > 0 ? parts.join(" · ") : "Connected" };
  });
}
